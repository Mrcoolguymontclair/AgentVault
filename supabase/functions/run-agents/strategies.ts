import {
  getDailyBars as _getDailyBars,
  getMostActives,
  getTopLosers,
  getAllNews,
} from "./alpaca.ts";
import {
  evalMispricing,
  interpretCustomStrategy,
  newsTraderDecision,
  blindQuantDecision,
  type AnonAsset,
} from "./groq.ts";
import {
  calculateSMA,
  calculateRSI,
  dipPercent,
  momentumPct,
  calculateBollingerBands,
  calculateVolumeMA,
  smaSlope,
  periodLow,
  periodHigh,
} from "./market-utils.ts";
import type { TradeSignal, BarData } from "./types.ts";

// ─────────────────────────────────────────────────────────────
// Market-data cache — shared across all strategy calls within one
// cron invocation so the same symbol is never fetched twice.
// index.ts calls clearMarketCache() once at the top of each run.
// ─────────────────────────────────────────────────────────────
const _barsCache = new Map<string, BarData[]>();

export function clearMarketCache(): void {
  _barsCache.clear();
}

// Last-run strategy diagnostics — written by EVERY strategy before returning null,
// so each agent sees ITS OWN diagnostics (not a shared neighbor's).
let _lastStrategyDiagnostics = "";
export function getLastStrategyDiagnostics(): string {
  return _lastStrategyDiagnostics;
}

/** Drop-in replacement for getDailyBars that serves from the in-memory cache. */
async function getDailyBars(symbol: string, count: number): Promise<BarData[]> {
  const cached = _barsCache.get(symbol);
  if (cached && cached.length >= count) return cached.slice(-count);
  const bars = await _getDailyBars(symbol, count);
  if (!cached || bars.length > cached.length) _barsCache.set(symbol, bars);
  return bars;
}

// ─────────────────────────────────────────────────────────────
// Fallback universes when screener API returns empty
// ─────────────────────────────────────────────────────────────
const TREND_FALLBACK = [
  "SPY", "QQQ", "NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "AMD",
];
const REVERT_FALLBACK = [
  "XBI", "ARKK", "COIN", "HOOD", "RIVN", "SMCI", "MU", "INTC", "BA", "F",
];

// Fixed ETF universe for Smart DCA
const DCA_SYMBOLS = ["SPY", "QQQ", "VTI", "VOO", "IWM", "DIA"];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function heldSymbols(positions: Record<string, number>): string[] {
  return Object.keys(positions).filter((s) => (positions[s] ?? 0) > 0);
}

/**
 * Shared trailing-stop checker.
 * Fires when a held position has been profitable (20d-high > avgCost × 1.01)
 * AND the current price has dropped ≥ stopPct from that 20d-high.
 * Returns a sell signal for the FIRST qualifying symbol, or null.
 */
async function checkTrailingStops(
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number>,
  stopPct = 0.03,
): Promise<TradeSignal | null> {
  for (const symbol of Object.keys(agentPositions)) {
    const heldQty = agentPositions[symbol] ?? 0;
    if (heldQty <= 0) continue;
    const avgCost = agentAvgCost[symbol] ?? 0;
    if (avgCost <= 0) continue;

    const bars = await getDailyBars(symbol, 25);
    if (bars.length < 5) continue;
    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];
    const window = Math.min(20, closes.length);
    const high20 = periodHigh(closes.slice(-window), window);

    // Only trigger if the position was profitable at some point
    const wasProfitable = high20 > avgCost * 1.01;
    const dropFromPeak = high20 > 0 ? (high20 - currentPrice) / high20 : 0;

    if (wasProfitable && dropFromPeak >= stopPct) {
      console.log(
        `[trailingStop] ${symbol}: $${currentPrice.toFixed(2)} dropped ${(dropFromPeak * 100).toFixed(1)}% from 20d-high $${high20.toFixed(2)} (avgCost $${avgCost.toFixed(2)})`,
      );
      return {
        symbol,
        side: "sell",
        notional: heldQty * currentPrice,
        reason:
          `Trailing stop: $${currentPrice.toFixed(2)} is ${(dropFromPeak * 100).toFixed(1)}% ` +
          `below 20d-high $${high20.toFixed(2)} (avg cost $${avgCost.toFixed(2)})`,
        strategyConfidence: 0.90,
        marketData: { currentPrice },
      };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 1. TREND RIDER (momentum_rider)
//    Universe: Alpaca most-actives screener (top 20 by trade count)
//    Buy: price above SMA20, volume ≥1.2× avg, positive SMA slope
//    Sell: price breaks below SMA20 by >2%, or trailing stop fires
// ─────────────────────────────────────────────────────────────
export async function momentumRider(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[TrendRider] fetching most-actives universe...";

  const stopSignal = await checkTrailingStops(agentPositions, agentAvgCost);
  if (stopSignal) return stopSignal;

  let universe = await getMostActives(20);
  if (universe.length === 0) {
    console.warn("[momentumRider] screener returned empty — using fallback universe");
    universe = TREND_FALLBACK;
  }
  // Skip cheap stocks (likely OTC / penny stocks)
  universe = universe.slice(0, 15);

  const lookback = 20;
  const volPeriod = 20;
  const diagLines: string[] = [`[TrendRider] universe=${universe.slice(0, 8).join(",")}`];
  let bestSignal: TradeSignal | null = null;
  let bestStrength = 0;

  for (const symbol of universe) {
    const bars = await getDailyBars(symbol, lookback + volPeriod + 5);
    if (bars.length < lookback + 5) {
      diagLines.push(`${symbol}:only_${bars.length}_bars`);
      continue;
    }

    const closes = bars.map((b) => b.c);
    const volumes = bars.map((b) => b.v);
    const currentPrice = closes[closes.length - 1];

    // Skip very cheap stocks
    if (currentPrice < 5) {
      diagLines.push(`${symbol}:price_$${currentPrice.toFixed(2)}_<$5`);
      continue;
    }

    const sma = calculateSMA(closes.slice(-lookback));
    const avgVol = calculateVolumeMA(volumes.slice(0, -1), volPeriod);
    const todayVol = volumes[volumes.length - 1];
    const volRatio = avgVol > 0 ? todayVol / avgVol : 0;
    const slope = smaSlope(closes, lookback, 5);
    const priceVsSma = (currentPrice - sma) / sma;
    const heldQty = agentPositions[symbol] ?? 0;

    if (heldQty > 0) {
      // ── Long exit: SMA breach ──────────────────────────────
      if (priceVsSma < -0.02) {
        const strength = Math.abs(priceVsSma);
        if (strength > bestStrength) {
          bestStrength = strength;
          bestSignal = {
            symbol,
            side: "sell",
            notional: heldQty * currentPrice,
            reason:
              `[TrendRider] SMA breach: $${currentPrice.toFixed(2)} is ` +
              `${(Math.abs(priceVsSma) * 100).toFixed(2)}% below SMA(${lookback}) $${sma.toFixed(2)}`,
            strategyConfidence: 0.80,
            marketData: { currentPrice, sma },
          };
        }
      }
    } else if (heldQty < 0) {
      // ── Short cover: price recovering toward SMA ───────────
      // Cover when price climbs back within 2% below SMA (short trade worked)
      // or when price goes above SMA (short trade is losing — cut loss)
      if (priceVsSma > -0.02) {
        const strength = Math.abs(priceVsSma) + 0.05; // slight priority boost
        if (strength > bestStrength) {
          bestStrength = strength;
          const coverReason = priceVsSma >= 0
            ? `[TrendRider] SHORT COVER (stop-loss): price $${currentPrice.toFixed(2)} rose above SMA $${sma.toFixed(2)}`
            : `[TrendRider] SHORT COVER (take-profit): price $${currentPrice.toFixed(2)} near SMA $${sma.toFixed(2)}`;
          bestSignal = {
            symbol,
            side: "buy",
            isShort: true,
            notional: Math.abs(heldQty) * currentPrice,
            reason: coverReason,
            strategyConfidence: 0.85,
            marketData: { currentPrice, sma },
          };
        }
      } else {
        diagLines.push(`${symbol}:SHORT_open pVsSma=${(priceVsSma * 100).toFixed(1)}% (holding short)`);
      }
    } else {
      // ── No position: check for long entry OR short entry ───
      if (priceVsSma >= 0 && priceVsSma <= 0.08 && volRatio >= 1.2 && slope > 0) {
        // Long entry: price above SMA, high volume, positive slope
        diagLines.push(`${symbol}:BUY pVsSma=${(priceVsSma * 100).toFixed(1)}% vol=${volRatio.toFixed(1)}x`);
        if (priceVsSma > bestStrength) {
          bestStrength = priceVsSma;
          bestSignal = {
            symbol,
            side: "buy",
            notional: 10,
            reason:
              `[TrendRider] $${currentPrice.toFixed(2)} is ${(priceVsSma * 100).toFixed(2)}% above SMA(${lookback}) ` +
              `$${sma.toFixed(2)}, vol ${volRatio.toFixed(1)}x avg, slope positive`,
            strategyConfidence: Math.min(1, priceVsSma * 8 + 0.35),
            marketData: { currentPrice, sma },
          };
        }
      } else if (priceVsSma <= -0.05 && volRatio >= 1.2 && slope < -0.0005) {
        // Short entry: price ≥5% below SMA, high volume, negative slope
        const shortStrength = Math.abs(priceVsSma);
        diagLines.push(`${symbol}:SHORT pVsSma=${(priceVsSma * 100).toFixed(1)}% vol=${volRatio.toFixed(1)}x slope=${slope.toFixed(4)}`);
        if (shortStrength > bestStrength) {
          bestStrength = shortStrength;
          bestSignal = {
            symbol,
            side: "sell",
            isShort: true,
            notional: 10, // % of budget (same convention as long buys)
            reason:
              `[TrendRider] SHORT: $${currentPrice.toFixed(2)} is ${(Math.abs(priceVsSma) * 100).toFixed(2)}% below SMA(${lookback}) ` +
              `$${sma.toFixed(2)}, vol ${volRatio.toFixed(1)}x avg, slope negative`,
            strategyConfidence: Math.min(1, shortStrength * 6 + 0.35),
            marketData: { currentPrice, sma },
          };
        }
      } else {
        diagLines.push(`${symbol}:no_signal pVsSma=${(priceVsSma * 100).toFixed(1)}% vol=${volRatio.toFixed(1)}x slope=${slope.toFixed(4)}`);
      }
    }
  }

  _lastStrategyDiagnostics = diagLines.slice(0, 10).join(" | ");
  console.log(`[momentumRider] ${_lastStrategyDiagnostics}`);
  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 2. BARGAIN HUNTER (mean_reversion)
//    Universe: Alpaca top-losers screener (biggest daily % decliners)
//    Buy: RSI<40, below lower Bollinger Band, 50d uptrend intact
//    Sell: RSI>60 (overbought), or trailing stop fires
// ─────────────────────────────────────────────────────────────
export async function meanReversion(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[BargainHunter] fetching top-losers universe...";

  const stopSignal = await checkTrailingStops(agentPositions, agentAvgCost);
  if (stopSignal) return stopSignal;

  let universe = await getTopLosers(20);
  if (universe.length === 0) {
    console.warn("[meanReversion] screener returned empty — using fallback universe");
    universe = REVERT_FALLBACK;
  }
  universe = universe.slice(0, 15);

  const rsiPeriod = 14;
  const rsiOversold = Number(config.rsi_oversold ?? 40);
  const rsiOverbought = Number(config.rsi_overbought ?? 60);
  const barsNeeded = 60;
  const diagLines: string[] = [`[BargainHunter] universe=${universe.slice(0, 8).join(",")}`];
  let bestSignal: TradeSignal | null = null;
  let bestExtreme = 0;

  for (const symbol of universe) {
    const bars = await getDailyBars(symbol, barsNeeded);
    if (bars.length < rsiPeriod + 20) {
      diagLines.push(`${symbol}:not_enough_bars`);
      continue;
    }

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];

    // Skip very cheap stocks (likely distressed / de-listed)
    if (currentPrice < 3) {
      diagLines.push(`${symbol}:price_$${currentPrice.toFixed(2)}_<$3`);
      continue;
    }

    const rsi = calculateRSI(closes, rsiPeriod);
    const bb = calculateBollingerBands(closes, 20, 2);
    const sma50 = closes.length >= 50 ? calculateSMA(closes.slice(-50)) : null;
    const sma50Prev = closes.length >= 55 ? calculateSMA(closes.slice(-55, -5)) : null;
    const inUptrend = sma50 !== null && sma50Prev !== null && sma50 >= sma50Prev;
    const heldQty = agentPositions[symbol] ?? 0;

    if (heldQty > 0) {
      // ── Long exit: overbought ────────────────────────────────
      if (rsi > rsiOverbought) {
        const extreme = rsi - rsiOverbought;
        if (extreme > bestExtreme) {
          bestExtreme = extreme;
          bestSignal = {
            symbol,
            side: "sell",
            notional: heldQty * currentPrice,
            reason: `[BargainHunter] RSI(${rsiPeriod})=${rsi.toFixed(1)}>${rsiOverbought} — overbought exit`,
            strategyConfidence: Math.min(1, extreme / 20 + 0.3),
            marketData: { currentPrice, rsi },
          };
        }
      }
    } else if (heldQty < 0) {
      // ── Short cover: RSI normalized back below 50 ────────────
      if (rsi < 50) {
        const extreme = 50 - rsi;
        if (extreme > bestExtreme) {
          bestExtreme = extreme;
          const coverReason = rsi < rsiOversold
            ? `[BargainHunter] SHORT COVER (take-profit): RSI(${rsiPeriod})=${rsi.toFixed(1)} — deeply oversold`
            : `[BargainHunter] SHORT COVER: RSI(${rsiPeriod})=${rsi.toFixed(1)} normalizing below 50`;
          bestSignal = {
            symbol,
            side: "buy",
            isShort: true,
            notional: Math.abs(heldQty) * currentPrice,
            reason: coverReason,
            strategyConfidence: Math.min(1, extreme / 20 + 0.45),
            marketData: { currentPrice, rsi },
          };
        }
      } else {
        diagLines.push(`${symbol}:SHORT_open RSI=${rsi.toFixed(1)} (holding short)`);
      }
    } else {
      // ── No position: check for long buy OR short entry ───────
      const belowBB = currentPrice <= bb.lower * 1.02;
      if (rsi < rsiOversold && belowBB && inUptrend) {
        const extreme = rsiOversold - rsi;
        if (extreme > bestExtreme) {
          bestExtreme = extreme;
          diagLines.push(
            `${symbol}:BUY RSI=${rsi.toFixed(1)} bb=${bb.lower.toFixed(2)} uptrend=true`,
          );
          bestSignal = {
            symbol,
            side: "buy",
            notional: 10,
            reason:
              `[BargainHunter] RSI(${rsiPeriod})=${rsi.toFixed(1)}<${rsiOversold}, ` +
              `below BB lower $${bb.lower.toFixed(2)}, 50d uptrend confirmed`,
            strategyConfidence: Math.min(1, extreme / 20 + 0.3),
            marketData: { currentPrice, rsi },
          };
        }
      } else {
        // Short entry: RSI > 80 AND above upper Bollinger Band (overbought extreme)
        const aboveBB = currentPrice >= bb.upper * 0.98;
        const shortRsiTrigger = 80;
        if (rsi > shortRsiTrigger && aboveBB) {
          const extreme = rsi - shortRsiTrigger;
          if (extreme > bestExtreme) {
            bestExtreme = extreme;
            diagLines.push(`${symbol}:SHORT RSI=${rsi.toFixed(1)} aboveBB=true`);
            bestSignal = {
              symbol,
              side: "sell",
              isShort: true,
              notional: 10,
              reason:
                `[BargainHunter] SHORT: RSI(${rsiPeriod})=${rsi.toFixed(1)}>${shortRsiTrigger}, ` +
                `price $${currentPrice.toFixed(2)} above BB upper $${bb.upper.toFixed(2)} — overbought`,
              strategyConfidence: Math.min(1, extreme / 20 + 0.3),
              marketData: { currentPrice, rsi },
            };
          }
        } else {
          diagLines.push(
            `${symbol}:RSI=${rsi.toFixed(1)} belowBB=${belowBB} uptrend=${inUptrend}`,
          );
        }
      }
    }
  }

  _lastStrategyDiagnostics = diagLines.slice(0, 10).join(" | ");
  console.log(`[meanReversion] ${_lastStrategyDiagnostics}`);
  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 3. NEWS TRADER (news_trader)
//    Universe: ALL recent Alpaca news (no symbol filter)
//    Pure sentiment — zero technical analysis.
//    One global news call → Groq evaluates every headline and
//    returns the single strongest sentiment trade.
// ─────────────────────────────────────────────────────────────
export async function newsTrader(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[NewsTrader] fetching global news stream...";

  const stopSignal = await checkTrailingStops(agentPositions, agentAvgCost);
  if (stopSignal) return stopSignal;

  // Default threshold: 0.3 (moderate sentiment triggers a trade).
  // config.sentiment_threshold is stored as integer tenths (e.g. 3 → 0.3, 6 → 0.6).
  const sentimentThreshold = Number(config.sentiment_threshold ?? 3) / 10;
  const maxPositions = Number(config.max_positions ?? 3);
  const held = heldSymbols(agentPositions);

  // Fetch ALL news — no symbol filter
  const rawNews = await getAllNews(50);
  if (rawNews.length === 0) {
    _lastStrategyDiagnostics = "[NewsTrader] no news articles returned from API";
    console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);
    return null;
  }

  // Build headlinesBySymbol from the full global news stream
  const headlinesBySymbol: Record<string, string[]> = {};
  for (const article of rawNews) {
    if (!article.headline) continue;
    for (const sym of article.symbols) {
      if (!headlinesBySymbol[sym]) headlinesBySymbol[sym] = [];
      headlinesBySymbol[sym].push(article.headline);
    }
  }

  const symbolCount = Object.keys(headlinesBySymbol).length;
  _lastStrategyDiagnostics =
    `[NewsTrader] ${rawNews.length} articles, ${symbolCount} unique symbols`;

  if (symbolCount === 0) {
    console.log(`[newsTrader] ${_lastStrategyDiagnostics} — no tagged symbols`);
    return null;
  }

  const decision = await newsTraderDecision({
    headlinesBySymbol,
    heldSymbols: held,
    sentimentThreshold,
  });

  if (!decision.execute || !decision.symbol) {
    _lastStrategyDiagnostics +=
      ` | no trade signal (score=${(decision.sentiment_score ?? 0).toFixed(2)})`;
    console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);
    return null;
  }
  if (Math.abs(decision.sentiment_score) < sentimentThreshold) {
    _lastStrategyDiagnostics +=
      ` | score ${decision.sentiment_score.toFixed(2)} below threshold ${sentimentThreshold}`;
    console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);
    return null;
  }

  const heldQty = agentPositions[decision.symbol] ?? 0;

  const bars = await getDailyBars(decision.symbol, 2);
  if (bars.length === 0) return null;
  const currentPrice = bars[bars.length - 1].c;

  const headlines = (headlinesBySymbol[decision.symbol] ?? []).slice(0, 5);
  const headlineText = headlines.map((h) => h.slice(0, 80)).join(" | ");

  // Short cover: bullish signal on a symbol we're already short
  if (decision.side === "buy" && heldQty < 0) {
    _lastStrategyDiagnostics +=
      ` | SHORT_COVER ${decision.symbol} score=${decision.sentiment_score.toFixed(2)}`;
    console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);
    return {
      symbol: decision.symbol,
      side: "buy",
      isShort: true,
      notional: Math.abs(heldQty) * currentPrice,
      reason:
        `[NewsTrader] SHORT COVER: sentiment turned positive (score=${decision.sentiment_score.toFixed(2)}) — ${decision.reasoning} | Headlines: ${headlineText}`,
      strategyConfidence: decision.confidence,
      skipAiConfirmation: true,
      marketData: { currentPrice, sentimentScore: decision.sentiment_score },
    };
  }

  if (decision.side === "buy" && heldQty > 0) return null; // already long
  if (decision.side === "buy" && held.length >= maxPositions) return null;

  // Short entry: strongly bearish signal on a symbol we don't own
  if (decision.side === "sell" && heldQty === 0) {
    _lastStrategyDiagnostics +=
      ` | SHORT_ENTRY ${decision.symbol} score=${decision.sentiment_score.toFixed(2)}`;
    console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);
    return {
      symbol: decision.symbol,
      side: "sell",
      isShort: true,
      notional: 15,
      reason:
        `[NewsTrader] SHORT: bearish sentiment score=${decision.sentiment_score.toFixed(2)} — ${decision.reasoning} | Headlines: ${headlineText}`,
      strategyConfidence: decision.confidence,
      skipAiConfirmation: true,
      marketData: { currentPrice, sentimentScore: decision.sentiment_score },
    };
  }

  if (decision.side === "sell" && heldQty < 0) return null; // already short

  // Regular long buy or long sell (close position)
  _lastStrategyDiagnostics +=
    ` | TRADE ${decision.side} ${decision.symbol} score=${decision.sentiment_score.toFixed(2)}`;
  console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);

  return {
    symbol: decision.symbol,
    side: decision.side,
    notional: decision.side === "buy" ? 15 : heldQty * currentPrice,
    reason:
      `[NewsTrader] score=${decision.sentiment_score.toFixed(2)} — ${decision.reasoning} | Headlines: ${headlineText}`,
    strategyConfidence: decision.confidence,
    skipAiConfirmation: true,
    marketData: { currentPrice, sentimentScore: decision.sentiment_score },
  };
}

// ─────────────────────────────────────────────────────────────
// 4. BLIND QUANT (blind_quant)
//    Universe: most-actives screener — rich volume data
//    Anonymizes all symbols (Asset_A, Asset_B…) and sends pure
//    numerical data to Groq. No ticker names, no sector info.
// ─────────────────────────────────────────────────────────────
export async function blindQuant(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[BlindQuant] fetching most-actives universe...";

  const stopSignal = await checkTrailingStops(agentPositions, agentAvgCost);
  if (stopSignal) return stopSignal;

  let universe = await getMostActives(15);
  if (universe.length === 0) {
    console.warn("[blindQuant] screener returned empty — using fallback universe");
    universe = TREND_FALLBACK;
  }
  universe = universe.slice(0, 15);

  const minConfidence = Number(config.min_confidence ?? 6) / 10;
  const maxPositions = Number(config.max_positions ?? 3);
  const held = heldSymbols(agentPositions);
  const assets: AnonAsset[] = [];
  const assetIdToSymbol: Record<string, string> = {};
  let idx = 0;

  for (const symbol of universe) {
    const bars = await getDailyBars(symbol, 30);
    if (bars.length < 22) continue;

    const closes = bars.map((b) => b.c);
    const volumes = bars.map((b) => b.v);
    const highs = bars.map((b) => b.h ?? b.c);
    const lows = bars.map((b) => b.l ?? b.c);

    const cur = closes[closes.length - 1];
    const p1d = closes[closes.length - 2] || cur;
    const p5d = closes[closes.length - 6] || closes[0];
    const p20d = closes[closes.length - 21] || closes[0];

    const change1d = p1d > 0 ? ((cur - p1d) / p1d) * 100 : 0;
    const change5d = p5d > 0 ? ((cur - p5d) / p5d) * 100 : 0;
    const change20d = p20d > 0 ? ((cur - p20d) / p20d) * 100 : 0;

    const avgVol = calculateVolumeMA(volumes.slice(0, -1), 20);
    const volRatio = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 1;

    const rsi14 = calculateRSI(closes, 14);
    const bb = calculateBollingerBands(closes, 20, 2);
    const bbRange = bb.upper - bb.lower;
    const bbPos = bbRange > 0 ? Math.min(1, Math.max(0, (cur - bb.lower) / bbRange)) : 0.5;

    const high20 = Math.max(...highs.slice(-20));
    const low20 = Math.min(...lows.slice(-20));
    const distHigh = high20 > 0 ? ((cur - high20) / high20) * 100 : 0;
    const distLow = low20 > 0 ? ((cur - low20) / low20) * 100 : 0;

    const ret20 = closes.slice(-21);
    const rets = ret20.slice(1).map((c, i) => (c - ret20[i]) / ret20[i]);
    const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
    const vol20 = Math.sqrt(rets.reduce((a, r) => a + (r - mu) ** 2, 0) / rets.length);

    const slope = smaSlope(closes, 20, 5);

    const assetId = `Asset_${String.fromCharCode(65 + idx)}`;
    assetIdToSymbol[assetId] = symbol;
    idx++;

    assets.push({
      asset_id: assetId,
      price_change_1d_pct: Number(change1d.toFixed(3)),
      price_change_5d_pct: Number(change5d.toFixed(3)),
      price_change_20d_pct: Number(change20d.toFixed(3)),
      volume_vs_avg_20d: Number(volRatio.toFixed(3)),
      rsi_14: Number(rsi14.toFixed(1)),
      distance_from_20d_high_pct: Number(distHigh.toFixed(3)),
      distance_from_20d_low_pct: Number(distLow.toFixed(3)),
      volatility_20d: Number(vol20.toFixed(4)),
      sma_20_slope: Number(slope.toFixed(5)),
      bollinger_position: Number(bbPos.toFixed(3)),
    });
  }

  _lastStrategyDiagnostics =
    `[BlindQuant] universe=${universe.slice(0, 8).join(",")} assets=${assets.length}`;

  if (assets.length === 0) {
    console.log(`[blindQuant] ${_lastStrategyDiagnostics} — no data`);
    return null;
  }

  const heldAssetIds = Object.entries(assetIdToSymbol)
    .filter(([, sym]) => (agentPositions[sym] ?? 0) > 0)
    .map(([id]) => id);

  const shortedAssetIds = Object.entries(assetIdToSymbol)
    .filter(([, sym]) => (agentPositions[sym] ?? 0) < 0)
    .map(([id]) => id);

  const decision = await blindQuantDecision({ assets, heldAssetIds, shortedAssetIds, minConfidence });

  if (!decision.execute || !decision.asset_id || decision.confidence < minConfidence) {
    _lastStrategyDiagnostics +=
      ` | no signal (confidence=${(decision.confidence ?? 0).toFixed(2)})`;
    console.log(`[blindQuant] ${_lastStrategyDiagnostics}`);
    return null;
  }

  const symbol = assetIdToSymbol[decision.asset_id];
  if (!symbol) return null;

  const heldQty = agentPositions[symbol] ?? 0;
  const bars = await getDailyBars(symbol, 2);
  if (bars.length === 0) return null;
  const currentPrice = bars[bars.length - 1].c;
  const anonAsset = assets.find((a) => a.asset_id === decision.asset_id);

  // Short cover: AI bullish on a symbol we're short
  if (decision.side === "buy" && heldQty < 0) {
    _lastStrategyDiagnostics +=
      ` | SHORT_COVER ${decision.asset_id}→${symbol} conf=${decision.confidence.toFixed(2)}`;
    console.log(`[blindQuant] ${_lastStrategyDiagnostics}`);
    return {
      symbol,
      side: "buy",
      isShort: true,
      notional: Math.abs(heldQty) * currentPrice,
      reason:
        `[BlindQuant] SHORT COVER ${decision.asset_id}→${symbol} | ${decision.reasoning} | ` +
        `data=${JSON.stringify(anonAsset)}`,
      strategyConfidence: decision.confidence,
      skipAiConfirmation: true,
      marketData: { currentPrice },
    };
  }

  if (decision.side === "buy" && heldQty > 0) return null; // already long
  if (decision.side === "buy" && held.length >= maxPositions) return null;

  // Short entry: AI bearish on a symbol we don't hold
  if (decision.side === "sell" && heldQty === 0) {
    _lastStrategyDiagnostics +=
      ` | SHORT_ENTRY ${decision.asset_id}→${symbol} conf=${decision.confidence.toFixed(2)}`;
    console.log(`[blindQuant] ${_lastStrategyDiagnostics}`);
    return {
      symbol,
      side: "sell",
      isShort: true,
      notional: 10,
      reason:
        `[BlindQuant] SHORT ${decision.asset_id}→${symbol} | ${decision.reasoning} | ` +
        `data=${JSON.stringify(anonAsset)}`,
      strategyConfidence: decision.confidence,
      skipAiConfirmation: true,
      marketData: { currentPrice },
    };
  }

  if (decision.side === "sell" && heldQty < 0) return null; // already short

  // Regular: long buy or close long
  _lastStrategyDiagnostics +=
    ` | TRADE ${decision.side} ${decision.asset_id}→${symbol} conf=${decision.confidence.toFixed(2)}`;
  console.log(`[blindQuant] ${_lastStrategyDiagnostics}`);

  return {
    symbol,
    side: decision.side,
    notional: decision.side === "buy" ? 10 : heldQty * currentPrice,
    reason:
      `[BlindQuant] ${decision.asset_id}→${symbol} | ${decision.reasoning} | ` +
      `data=${JSON.stringify(anonAsset)}`,
    strategyConfidence: decision.confidence,
    skipAiConfirmation: true,
    marketData: { currentPrice },
  };
}

// ─────────────────────────────────────────────────────────────
// 5. SMART DCA (dca_plus)
//    Universe: fixed ETFs [SPY, QQQ, VTI, VOO, IWM, DIA]
//    Buy on 3%/5%/8% dips below 20d avg; 1.5× size on market fear.
//    Take-profit: sell when up 10% from avg cost.
//    Trailing stop: 5% from 20d-high (looser for ETFs).
// ─────────────────────────────────────────────────────────────
export async function dcaPlus(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = `[SmartDCA] universe=${DCA_SYMBOLS.join(",")}`;
  console.log(`[dcaPlus] ${_lastStrategyDiagnostics}`);

  // 5% trailing stop for ETFs (wider than equity strategies)
  const stopSignal = await checkTrailingStops(agentPositions, agentAvgCost, 0.05);
  if (stopSignal) return stopSignal;

  const baseAmount = Number(config.base_amount ?? 100);

  // ── Take-profit check ─────────────────────────────────────────
  for (const symbol of DCA_SYMBOLS) {
    const heldQty = agentPositions[symbol] ?? 0;
    if (heldQty <= 0) continue;
    const avgCost = agentAvgCost[symbol] ?? 0;
    if (avgCost <= 0) continue;

    const bars = await getDailyBars(symbol, 2);
    if (bars.length === 0) continue;
    const price = bars[bars.length - 1].c;
    const gainPct = ((price - avgCost) / avgCost) * 100;

    if (gainPct >= 10) {
      return {
        symbol,
        side: "sell",
        notional: heldQty * price,
        reason:
          `[SmartDCA] take-profit: ${gainPct.toFixed(1)}% gain from avg cost $${avgCost.toFixed(2)}`,
        strategyConfidence: 0.95,
        marketData: { currentPrice: price, dipPct: gainPct },
      };
    }
  }

  // ── Market fear: SPY down >2% today ───────────────────────────
  let marketFear = false;
  const spyBars = await getDailyBars("SPY", 3);
  if (spyBars.length >= 2) {
    const spyChange =
      ((spyBars[spyBars.length - 1].c - spyBars[spyBars.length - 2].c) /
        spyBars[spyBars.length - 2].c) *
      100;
    marketFear = spyChange < -2;
    _lastStrategyDiagnostics +=
      ` | spyChange=${spyChange.toFixed(2)}%${marketFear ? " FEAR" : ""}`;
  }

  // ── Buy on dip ────────────────────────────────────────────────
  let bestSignal: TradeSignal | null = null;
  let bestDip = -Infinity;

  for (const symbol of DCA_SYMBOLS) {
    const bars = await getDailyBars(symbol, 22);
    if (bars.length < 10) continue;

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];
    const avg20 = calculateSMA(closes.slice(0, -1));
    const dip = dipPercent(currentPrice, avg20);
    const heldQty = agentPositions[symbol] ?? 0;

    if (dip > bestDip) {
      bestDip = dip;

      const isDip = dip >= 3;
      let sizeMultiplier = 1;
      if (dip >= 8) sizeMultiplier = 3;
      else if (dip >= 5) sizeMultiplier = 2;
      if (marketFear) sizeMultiplier = Math.min(4, Math.ceil(sizeMultiplier * 1.5));

      // Don't regular-DCA while already holding; only buy on dips
      if (!isDip && heldQty > 0) continue;

      bestSignal = {
        symbol,
        side: "buy",
        notional: baseAmount * sizeMultiplier,
        reason: isDip
          ? `[SmartDCA] dip ${dip.toFixed(2)}% below 20d avg $${avg20.toFixed(2)} — ${sizeMultiplier}×$${baseAmount}${marketFear ? " + fear bonus" : ""}`
          : `[SmartDCA] scheduled DCA: ${dip.toFixed(2)}% vs avg, base $${baseAmount} buy`,
        strategyConfidence: isDip ? 0.80 : 0.65,
        marketData: { currentPrice, dipPct: dip },
      };
    }
  }

  _lastStrategyDiagnostics += ` | bestDip=${bestDip.toFixed(2)}%`;
  console.log(`[dcaPlus] ${_lastStrategyDiagnostics}`);
  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 6. PREDICTION PRO (prediction_arb)
//    Universe: most-actives screener, prioritised by news overlap.
//    Kelly Criterion: only trade when AI confidence − market prob >15%.
//    Stocks mentioned in both most-actives AND recent news get
//    evaluated first (event-driven catalyst).
// ─────────────────────────────────────────────────────────────
export async function predictionArb(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[PredictionPro] fetching most-actives + news...";

  const stopSignal = await checkTrailingStops(agentPositions, agentAvgCost);
  if (stopSignal) return stopSignal;

  let universe = await getMostActives(10);
  if (universe.length === 0) universe = TREND_FALLBACK.slice(0, 10);

  // Find symbols that appear in both most-actives AND recent news (event-driven)
  const rawNews = await getAllNews(30);
  const newsSymbols = new Set<string>();
  for (const article of rawNews) {
    for (const sym of article.symbols) newsSymbols.add(sym);
  }

  const withNews = universe.filter((s) => newsSymbols.has(s));
  const withoutNews = universe.filter((s) => !newsSymbols.has(s));
  // Evaluate news-catalysts first, cap at 5 symbols total to limit Groq calls
  const sample = [...withNews, ...withoutNews].slice(0, 5);

  _lastStrategyDiagnostics =
    `[PredictionPro] active=${universe.slice(0, 6).join(",")} withNews=${withNews.join(",")||"none"}`;

  const confidenceThreshold = Number(config.confidence_threshold ?? 70) / 100;
  const held = heldSymbols(agentPositions);
  let bestSignal: TradeSignal | null = null;
  let bestEdge = 0;

  for (const symbol of sample) {
    const bars = await getDailyBars(symbol, 25);
    if (bars.length < 10) continue;

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];
    const rsi = calculateRSI(closes, 14);
    const mom5d = momentumPct(closes, 5);
    const heldQty = agentPositions[symbol] ?? 0;

    const { direction, confidence, marketProbability, reasoning } = await evalMispricing({
      symbol,
      currentPrice,
      rsi,
      momentum5d: mom5d,
    });

    if (direction === "hold" || confidence < confidenceThreshold) continue;
    const edge = confidence - marketProbability;
    if (edge < 0.15 || edge <= bestEdge) continue;

    const kellyFraction = edge / Math.max(0.01, 1 - marketProbability);
    const kellySizePct = Math.min(15, Math.max(2, kellyFraction * 20));
    const hasCatalyst = newsSymbols.has(symbol);

    if (direction === "buy" && heldQty < 0) {
      // Short cover: AI bullish on a symbol we're short
      bestEdge = edge;
      bestSignal = {
        symbol,
        side: "buy",
        isShort: true,
        notional: Math.abs(heldQty) * currentPrice,
        reason:
          `[PredictionPro] SHORT COVER: bullish AI ${(confidence * 100).toFixed(0)}% vs market ${(marketProbability * 100).toFixed(0)}% ` +
          `(edge ${(edge * 100).toFixed(0)}%): ${reasoning}` +
          (hasCatalyst ? " [news catalyst]" : ""),
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    } else if (direction === "buy" && heldQty === 0) {
      bestEdge = edge;
      bestSignal = {
        symbol,
        side: "buy",
        notional: kellySizePct,
        reason:
          `[PredictionPro] AI ${(confidence * 100).toFixed(0)}% vs market ${(marketProbability * 100).toFixed(0)}% ` +
          `(Kelly edge ${(edge * 100).toFixed(0)}%, size ${kellySizePct.toFixed(1)}%): ${reasoning}` +
          (hasCatalyst ? " [news catalyst]" : ""),
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    } else if (direction === "sell" && heldQty > 0) {
      bestEdge = edge;
      bestSignal = {
        symbol,
        side: "sell",
        notional: heldQty * currentPrice,
        reason:
          `[PredictionPro] overpriced AI ${(confidence * 100).toFixed(0)}% vs market ${(marketProbability * 100).toFixed(0)}% ` +
          `(edge ${(edge * 100).toFixed(0)}%): ${reasoning}`,
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    } else if (direction === "sell" && heldQty === 0) {
      // Short entry: AI bearish with high confidence
      bestEdge = edge;
      bestSignal = {
        symbol,
        side: "sell",
        isShort: true,
        notional: kellySizePct,
        reason:
          `[PredictionPro] SHORT: AI ${(confidence * 100).toFixed(0)}% bearish vs market ${(marketProbability * 100).toFixed(0)}% ` +
          `(Kelly edge ${(edge * 100).toFixed(0)}%, size ${kellySizePct.toFixed(1)}%): ${reasoning}` +
          (hasCatalyst ? " [news catalyst]" : ""),
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    }
  }

  _lastStrategyDiagnostics += ` | bestEdge=${bestEdge.toFixed(2)}`;
  console.log(`[predictionArb] ${_lastStrategyDiagnostics}`);
  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 7. YOUR RULES (custom)
//    Universe: most-actives screener — dynamic, high-liquidity names
//    User's plain-English strategy_prompt evaluated by Groq with
//    live market data for each symbol. Confidence threshold: 0.70.
// ─────────────────────────────────────────────────────────────
export async function customStrategy(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
): Promise<TradeSignal | null> {
  const strategyPrompt = (config.strategy_prompt as string | undefined)?.trim().slice(0, 500);
  if (!strategyPrompt || strategyPrompt.length < 10) {
    _lastStrategyDiagnostics = "[YourRules] no strategy_prompt configured — skipping";
    console.warn(`[customStrategy] ${_lastStrategyDiagnostics}`);
    return null;
  }

  _lastStrategyDiagnostics = "[YourRules] fetching most-actives universe...";

  const stopSignal = await checkTrailingStops(agentPositions, agentAvgCost);
  if (stopSignal) return stopSignal;

  let universe = await getMostActives(10);
  if (universe.length === 0) universe = TREND_FALLBACK.slice(0, 10);

  type MarketPoint = {
    symbol: string;
    currentPrice: number;
    change1d: number;
    sma20: number;
    rsi14: number;
    momentum5d: number;
  };

  const marketData: MarketPoint[] = [];

  for (const symbol of universe) {
    try {
      const bars = await getDailyBars(symbol, 25);
      if (bars.length < 20) continue;
      const closes = bars.map((b) => b.c);
      const currentPrice = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];
      marketData.push({
        symbol,
        currentPrice,
        change1d: ((currentPrice - prevClose) / prevClose) * 100,
        sma20: calculateSMA(closes.slice(-20)),
        rsi14: calculateRSI(closes, 14),
        momentum5d: momentumPct(closes, 5),
      });
    } catch {
      // skip on fetch error
    }
  }

  _lastStrategyDiagnostics =
    `[YourRules] universe=${universe.slice(0, 6).join(",")} prompt="${strategyPrompt.slice(0, 60)}..."`;

  if (marketData.length === 0) {
    console.log(`[customStrategy] ${_lastStrategyDiagnostics} — no market data`);
    return null;
  }

  const { execute, symbol, side, reasoning, confidence } = await interpretCustomStrategy({
    strategyPrompt,
    marketData,
    currentPositions: agentPositions,
  });

  if (!execute || !symbol || confidence < 0.70) {
    _lastStrategyDiagnostics +=
      ` | no signal (confidence=${(confidence ?? 0).toFixed(2)})`;
    console.log(`[customStrategy] ${_lastStrategyDiagnostics}`);
    return null;
  }

  const symbolData = marketData.find((d) => d.symbol === symbol);
  if (!symbolData) return null;

  const heldQty = agentPositions[symbol] ?? 0;

  // Short cover: strategy says buy but we're short
  if (side === "buy" && heldQty < 0) {
    _lastStrategyDiagnostics +=
      ` | SHORT_COVER ${symbol} conf=${confidence.toFixed(2)}`;
    console.log(`[customStrategy] ${_lastStrategyDiagnostics}`);
    return {
      symbol,
      side: "buy",
      isShort: true,
      notional: Math.abs(heldQty) * symbolData.currentPrice,
      reason: `[YourRules] SHORT COVER confidence ${(confidence * 100).toFixed(0)}%: ${reasoning}`,
      strategyConfidence: confidence,
      marketData: { currentPrice: symbolData.currentPrice, rsi: symbolData.rsi14 },
    };
  }

  if (side === "buy" && heldQty > 0) return null; // already long

  // Short entry: strategy says sell but we don't hold the stock
  if (side === "sell" && heldQty === 0) {
    // Only short if the user's instructions explicitly mention shorting
    const allowsShort = /\bshort\b/i.test(strategyPrompt);
    if (!allowsShort) return null;
    _lastStrategyDiagnostics +=
      ` | SHORT_ENTRY ${symbol} conf=${confidence.toFixed(2)}`;
    console.log(`[customStrategy] ${_lastStrategyDiagnostics}`);
    return {
      symbol,
      side: "sell",
      isShort: true,
      notional: 10,
      reason: `[YourRules] SHORT confidence ${(confidence * 100).toFixed(0)}%: ${reasoning}`,
      strategyConfidence: confidence,
      marketData: { currentPrice: symbolData.currentPrice, rsi: symbolData.rsi14 },
    };
  }

  if (side === "sell" && heldQty < 0) return null; // already short

  _lastStrategyDiagnostics +=
    ` | TRADE ${side} ${symbol} conf=${confidence.toFixed(2)}`;
  console.log(`[customStrategy] ${_lastStrategyDiagnostics}`);

  return {
    symbol,
    side,
    notional: side === "buy" ? 10 : heldQty * symbolData.currentPrice,
    reason: `[YourRules] confidence ${(confidence * 100).toFixed(0)}%: ${reasoning}`,
    strategyConfidence: confidence,
    marketData: { currentPrice: symbolData.currentPrice, rsi: symbolData.rsi14 },
  };
}

// ─────────────────────────────────────────────────────────────
// Router — dispatches to the correct strategy function.
// agentAvgCost is passed to all strategies for trailing-stop support.
// ─────────────────────────────────────────────────────────────
export async function runStrategy(
  strategyId: string,
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
): Promise<TradeSignal | null> {
  switch (strategyId) {
    case "momentum_rider":
      return momentumRider(config, agentPositions, agentAvgCost);
    case "mean_reversion":
      return meanReversion(config, agentPositions, agentAvgCost);
    case "prediction_arb":
      return predictionArb(config, agentPositions, agentAvgCost);
    case "dca_plus":
      return dcaPlus(config, agentPositions, agentAvgCost);
    case "custom":
      return customStrategy(config, agentPositions, agentAvgCost);
    case "news_trader":
      return newsTrader(config, agentPositions, agentAvgCost);
    case "blind_quant":
      return blindQuant(config, agentPositions, agentAvgCost);
    default:
      console.warn(`[runStrategy] Unknown strategy: ${strategyId}`);
      return null;
  }
}
