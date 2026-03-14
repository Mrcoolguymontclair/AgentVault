import { getDailyBars, getLatestPrice, getNews } from "./alpaca.ts";
import { scoreSentiment, evalMispricing } from "./groq.ts";
import { calculateSMA, calculateRSI, dipPercent, momentumPct } from "./market-utils.ts";
import type { TradeSignal } from "./types.ts";

const WATCHLIST = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN"];
const DCA_SYMBOLS = ["SPY", "QQQ", "AAPL"];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
type TimeHorizon = "fast" | "medium" | "slow";

function resolveHorizon(config: Record<string, any>): TimeHorizon {
  const h = config.time_horizon as string | undefined;
  if (h === "fast" || h === "slow") return h;
  return "medium";
}

// ─────────────────────────────────────────────────────────────
// 1. MOMENTUM RIDER
//    Buy when price breaks above SMA, sell when below.
//    Fast → SMA(9), Medium → SMA(20), Slow → SMA(50)
// ─────────────────────────────────────────────────────────────
export async function momentumRider(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const lookback = horizon === "fast" ? 9 : horizon === "slow" ? 50 : 20;
  const positionSizePct = horizon === "fast" ? 5 : horizon === "slow" ? 15 : 10;

  let bestSignal: TradeSignal | null = null;
  let bestStrength = 0;

  for (const symbol of WATCHLIST) {
    const bars = await getDailyBars(symbol, lookback + 5);
    if (bars.length < lookback) continue;

    const closes = bars.map((b) => b.c);
    const sma = calculateSMA(closes.slice(-lookback));
    const currentPrice = closes[closes.length - 1];
    const heldQty = agentPositions[symbol] ?? 0;

    const priceVsSma = (currentPrice - sma) / sma;

    if (currentPrice > sma * 1.001 && heldQty === 0) {
      const strength = priceVsSma;
      if (strength > bestStrength) {
        bestStrength = strength;
        bestSignal = {
          symbol,
          side: "buy",
          notional: positionSizePct,
          reason: `Price $${currentPrice.toFixed(2)} is ${(priceVsSma * 100).toFixed(2)}% above SMA(${lookback}) $${sma.toFixed(2)} [${horizon} horizon]`,
          strategyConfidence: Math.min(1, strength * 5),
          marketData: { currentPrice, sma },
        };
      }
    } else if (currentPrice < sma * 0.999 && heldQty > 0) {
      const strength = Math.abs(priceVsSma);
      if (strength > bestStrength) {
        bestStrength = strength;
        bestSignal = {
          symbol,
          side: "sell",
          notional: heldQty * currentPrice,
          reason: `Price $${currentPrice.toFixed(2)} dropped ${(Math.abs(priceVsSma) * 100).toFixed(2)}% below SMA(${lookback}) $${sma.toFixed(2)} — exit [${horizon} horizon]`,
          strategyConfidence: Math.min(1, strength * 5),
          marketData: { currentPrice, sma },
        };
      }
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 2. MEAN REVERSION
//    Fast: RSI(7) thresholds 25/75
//    Medium: RSI(14) thresholds 30/70
//    Slow: RSI(21) thresholds 35/65
// ─────────────────────────────────────────────────────────────
export async function meanReversion(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const rsiPeriod    = horizon === "fast" ? 7  : horizon === "slow" ? 21 : 14;
  const rsiOversold  = horizon === "fast" ? 25 : horizon === "slow" ? 35 : 30;
  const rsiOverbought = horizon === "fast" ? 75 : horizon === "slow" ? 65 : 70;
  const positionSizePct = horizon === "fast" ? 5 : horizon === "slow" ? 15 : 10;

  // Need enough bars for RSI calculation
  const barsNeeded = rsiPeriod * 3;

  let bestSignal: TradeSignal | null = null;
  let bestExtreme = 0;

  for (const symbol of WATCHLIST) {
    const bars = await getDailyBars(symbol, barsNeeded);
    if (bars.length < rsiPeriod + 1) continue;

    const closes = bars.map((b) => b.c);
    const rsi = calculateRSI(closes, rsiPeriod);
    const currentPrice = closes[closes.length - 1];
    const heldQty = agentPositions[symbol] ?? 0;

    if (rsi < rsiOversold && heldQty === 0) {
      const extreme = rsiOversold - rsi;
      if (extreme > bestExtreme) {
        bestExtreme = extreme;
        bestSignal = {
          symbol,
          side: "buy",
          notional: positionSizePct,
          reason: `RSI(${rsiPeriod}) = ${rsi.toFixed(1)} oversold below ${rsiOversold} — mean reversion buy [${horizon} horizon]`,
          strategyConfidence: Math.min(1, extreme / 20),
          marketData: { currentPrice, rsi },
        };
      }
    } else if (rsi > rsiOverbought && heldQty > 0) {
      const extreme = rsi - rsiOverbought;
      if (extreme > bestExtreme) {
        bestExtreme = extreme;
        bestSignal = {
          symbol,
          side: "sell",
          notional: heldQty * currentPrice,
          reason: `RSI(${rsiPeriod}) = ${rsi.toFixed(1)} overbought above ${rsiOverbought} — mean reversion sell [${horizon} horizon]`,
          strategyConfidence: Math.min(1, extreme / 20),
          marketData: { currentPrice, rsi },
        };
      }
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 3. NEWS SENTIMENT
//    Fast: reacts to news within 1 hour
//    Medium: within 24 hours
//    Slow: within 1 week (168 hours)
// ─────────────────────────────────────────────────────────────
export async function newsSentiment(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const maxAgeHours = horizon === "fast" ? 1 : horizon === "slow" ? 168 : 24;
  const sentimentThreshold = (config.sentiment_threshold ?? 6) / 10;
  const positionSizePct = horizon === "fast" ? 5 : horizon === "slow" ? 15 : 10;

  const cutoffMs = Date.now() - maxAgeHours * 3600 * 1000;

  let bestSignal: TradeSignal | null = null;
  let bestScore = 0;

  for (const symbol of WATCHLIST.slice(0, 4)) {
    const news = await getNews(symbol);
    if (news.length === 0) continue;

    // Filter by recency based on time horizon
    const recentNews = news.filter((n: any) => {
      const ts = n.created_at ?? n.updated_at ?? n.timestamp;
      if (!ts) return true;
      return new Date(ts).getTime() >= cutoffMs;
    });
    if (recentNews.length === 0) continue;

    const headlines = recentNews.map((n: any) => n.headline);
    const { score, summary } = await scoreSentiment(symbol, headlines);
    const absScore = Math.abs(score);

    if (absScore < sentimentThreshold) continue;

    const currentPrice = await getLatestPrice(symbol);
    if (currentPrice === 0) continue;

    const heldQty = agentPositions[symbol] ?? 0;

    if (score > sentimentThreshold && heldQty === 0) {
      if (absScore > bestScore) {
        bestScore = absScore;
        bestSignal = {
          symbol,
          side: "buy",
          notional: positionSizePct,
          reason: `Positive news sentiment (score ${score.toFixed(2)}, ${maxAgeHours}h window): ${summary} [${horizon} horizon]`,
          strategyConfidence: absScore,
          marketData: { currentPrice },
        };
      }
    } else if (score < -sentimentThreshold && heldQty > 0) {
      if (absScore > bestScore) {
        bestScore = absScore;
        bestSignal = {
          symbol,
          side: "sell",
          notional: heldQty * currentPrice,
          reason: `Negative news sentiment (score ${score.toFixed(2)}, ${maxAgeHours}h window): ${summary} [${horizon} horizon]`,
          strategyConfidence: absScore,
          marketData: { currentPrice },
        };
      }
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 4. PREDICTION ARBITRAGE
//    Fast: 60% AI confidence threshold
//    Medium: 70%
//    Slow: 80%
// ─────────────────────────────────────────────────────────────
export async function predictionArb(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const confidenceThreshold = horizon === "fast" ? 0.60 : horizon === "slow" ? 0.80 : 0.70;
  const maxBetPct = horizon === "fast" ? 5 : horizon === "slow" ? 15 : 10;

  let bestSignal: TradeSignal | null = null;
  let bestConfidence = 0;

  const sample = WATCHLIST.sort(() => Math.random() - 0.5).slice(0, 3);

  for (const symbol of sample) {
    const bars = await getDailyBars(symbol, 20);
    if (bars.length < 10) continue;

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];
    const rsi = calculateRSI(closes, 14);
    const mom5d = momentumPct(closes, 5);
    const heldQty = agentPositions[symbol] ?? 0;

    const { direction, confidence, reasoning } = await evalMispricing({
      symbol,
      currentPrice,
      rsi,
      momentum5d: mom5d,
    });

    if (confidence < confidenceThreshold || direction === "hold") continue;
    if (confidence <= bestConfidence) continue;

    if (direction === "buy" && heldQty === 0) {
      bestConfidence = confidence;
      bestSignal = {
        symbol,
        side: "buy",
        notional: maxBetPct,
        reason: `Mispricing detected (confidence ${(confidence * 100).toFixed(0)}% ≥ ${(confidenceThreshold * 100).toFixed(0)}% threshold): ${reasoning} [${horizon} horizon]`,
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    } else if (direction === "sell" && heldQty > 0) {
      bestConfidence = confidence;
      bestSignal = {
        symbol,
        side: "sell",
        notional: heldQty * currentPrice,
        reason: `Overpriced (confidence ${(confidence * 100).toFixed(0)}%): ${reasoning} [${horizon} horizon]`,
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 5. DCA+
//    Fast: dips on 1%, Medium: 3%, Slow: 7%
// ─────────────────────────────────────────────────────────────
export async function dcaPlus(
  config: Record<string, any>
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const dipThreshold = horizon === "fast" ? 1 : horizon === "slow" ? 7 : 3;
  const baseAmount = config.base_amount ?? 100;
  const dipMultiplier = config.dip_multiplier ?? 2;

  let bestSignal: TradeSignal | null = null;
  let bestDip = -Infinity;

  for (const symbol of DCA_SYMBOLS) {
    const bars = await getDailyBars(symbol, 22);
    if (bars.length < 5) continue;

    const closes = bars.map((b) => b.c);
    const avg20 = calculateSMA(closes.slice(0, -1));
    const currentPrice = closes[closes.length - 1];
    const dip = dipPercent(currentPrice, avg20);

    if (dip > bestDip) {
      bestDip = dip;
      const isDip = dip >= dipThreshold;
      const notional = isDip ? baseAmount * dipMultiplier : baseAmount;

      bestSignal = {
        symbol,
        side: "buy",
        notional,
        reason: isDip
          ? `Dip of ${dip.toFixed(2)}% below 20-day avg (threshold ${dipThreshold}%) — DCA dip buy ×${dipMultiplier} [${horizon} horizon]`
          : `Scheduled DCA buy (${dip.toFixed(2)}% vs avg — no ${dipThreshold}% dip yet) [${horizon} horizon]`,
        strategyConfidence: isDip ? 0.8 : 0.65,
        marketData: { currentPrice, dipPct: dip },
      };
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────
export async function runStrategy(
  strategyId: string,
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  switch (strategyId) {
    case "momentum_rider":
      return momentumRider(config, agentPositions);
    case "mean_reversion":
      return meanReversion(config, agentPositions);
    case "news_sentiment":
      return newsSentiment(config, agentPositions);
    case "prediction_arb":
      return predictionArb(config, agentPositions);
    case "dca_plus":
      return dcaPlus(config);
    default:
      console.warn(`Unknown strategy: ${strategyId}`);
      return null;
  }
}
