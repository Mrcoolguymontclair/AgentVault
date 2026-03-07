import { getDailyBars, getLatestPrice, getNews } from "./alpaca.ts";
import { scoreSentiment, evalMispricing } from "./groq.ts";
import { calculateSMA, calculateRSI, dipPercent, momentumPct } from "./market-utils.ts";
import type { TradeSignal } from "./types.ts";

const WATCHLIST = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN"];
const DCA_SYMBOLS = ["SPY", "QQQ", "AAPL"];

// ─────────────────────────────────────────────────────────────
// 1. MOMENTUM RIDER
//    Buy when price breaks above SMA(lookback), sell when below
// ─────────────────────────────────────────────────────────────
export async function momentumRider(
  config: Record<string, number>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const lookback = config.lookback ?? 20;
  const positionSizePct = config.position_size ?? 10;

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
      // Price broke above SMA → buy
      const strength = priceVsSma;
      if (strength > bestStrength) {
        bestStrength = strength;
        bestSignal = {
          symbol,
          side: "buy",
          notional: positionSizePct,
          reason: `Price $${currentPrice.toFixed(2)} is ${(priceVsSma * 100).toFixed(2)}% above ${lookback}-day SMA $${sma.toFixed(2)}`,
          strategyConfidence: Math.min(1, strength * 5),
          marketData: { currentPrice, sma },
        };
      }
    } else if (currentPrice < sma * 0.999 && heldQty > 0) {
      // Price broke below SMA → sell existing position
      const strength = Math.abs(priceVsSma);
      if (strength > bestStrength) {
        bestStrength = strength;
        bestSignal = {
          symbol,
          side: "sell",
          notional: heldQty * currentPrice,
          reason: `Price $${currentPrice.toFixed(2)} dropped ${(Math.abs(priceVsSma) * 100).toFixed(2)}% below SMA $${sma.toFixed(2)} — exit position`,
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
//    Buy oversold (RSI < threshold), sell overbought (RSI > threshold)
// ─────────────────────────────────────────────────────────────
export async function meanReversion(
  config: Record<string, number>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const rsiOversold = config.rsi_oversold ?? 30;
  const rsiOverbought = config.rsi_overbought ?? 70;
  const positionSizePct = config.position_size ?? 10;

  let bestSignal: TradeSignal | null = null;
  let bestExtreme = 0;

  for (const symbol of WATCHLIST) {
    const bars = await getDailyBars(symbol, 30);
    if (bars.length < 15) continue;

    const closes = bars.map((b) => b.c);
    const rsi = calculateRSI(closes, 14);
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
          reason: `RSI(14) = ${rsi.toFixed(1)} is oversold (below ${rsiOversold}) — mean reversion buy`,
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
          reason: `RSI(14) = ${rsi.toFixed(1)} is overbought (above ${rsiOverbought}) — mean reversion sell`,
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
//    Use Groq to score Alpaca news headlines, trade on extreme sentiment
// ─────────────────────────────────────────────────────────────
export async function newsSentiment(
  config: Record<string, number>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  // sentiment_threshold stored as ×10 in config (e.g. 6 = 0.6)
  const sentimentThreshold = (config.sentiment_threshold ?? 6) / 10;
  const positionSizePct = config.position_size ?? 8;

  let bestSignal: TradeSignal | null = null;
  let bestScore = 0;

  // Only score 4 symbols to limit Groq API calls
  for (const symbol of WATCHLIST.slice(0, 4)) {
    const news = await getNews(symbol);
    if (news.length === 0) continue;

    const headlines = news.map((n) => n.headline);
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
          reason: `Positive news sentiment (score ${score.toFixed(2)}): ${summary}`,
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
          reason: `Negative news sentiment (score ${score.toFixed(2)}): ${summary}`,
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
//    Use Groq to identify mispricings; trade on high-confidence calls
// ─────────────────────────────────────────────────────────────
export async function predictionArb(
  config: Record<string, number>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  // confidence_threshold stored ×10 (e.g. 7 = 0.7)
  const confidenceThreshold = (config.confidence_threshold ?? 7) / 10;
  const maxBetPct = config.max_bet ?? 5;

  let bestSignal: TradeSignal | null = null;
  let bestConfidence = 0;

  // Sample 3 symbols to limit API calls
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
        reason: `Mispricing detected (confidence ${(confidence * 100).toFixed(0)}%): ${reasoning}`,
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    } else if (direction === "sell" && heldQty > 0) {
      bestConfidence = confidence;
      bestSignal = {
        symbol,
        side: "sell",
        notional: heldQty * currentPrice,
        reason: `Overpriced (confidence ${(confidence * 100).toFixed(0)}%): ${reasoning}`,
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 5. DCA+
//    Buy on schedule; multiply position on dips
// ─────────────────────────────────────────────────────────────
export async function dcaPlus(
  config: Record<string, number>
): Promise<TradeSignal | null> {
  const baseAmount = config.base_amount ?? 100;
  const dipMultiplier = config.dip_multiplier ?? 2;
  const dipThreshold = config.dip_threshold ?? 3;

  let bestSignal: TradeSignal | null = null;
  let bestDip = -Infinity;

  for (const symbol of DCA_SYMBOLS) {
    const bars = await getDailyBars(symbol, 22);
    if (bars.length < 5) continue;

    const closes = bars.map((b) => b.c);
    const avg20 = calculateSMA(closes.slice(0, -1)); // 20-day avg (excluding today)
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
          ? `Dip of ${dip.toFixed(2)}% below 20-day avg — DCA dip buy ×${dipMultiplier}`
          : `Scheduled DCA buy (${dip.toFixed(2)}% vs avg — no significant dip)`,
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
  config: Record<string, number>,
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
