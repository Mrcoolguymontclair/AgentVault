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
  calculateATR,
  distanceFromHighPct,
  distanceFromLowPct,
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

// Last-run strategy diagnostics — written by EVERY strategy before returning null.
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

// Smart DCA: only the three biggest broad-market ETFs.
const DCA_SYMBOLS = ["SPY", "QQQ", "VTI"];

// ─────────────────────────────────────────────────────────────
// Global entry-rule constants (apply to ALL long entries)
// ─────────────────────────────────────────────────────────────
export const MIN_PRICE = 20;
export const MIN_AVG_VOLUME = 1_000_000;
export const MAX_OPEN_POSITIONS = 3;
export const MAX_POSITION_PCT = 0.25; // 25% of budget per position
export const AI_CONFIDENCE_FLOOR = 0.70;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function heldSymbols(positions: Record<string, number>): string[] {
  return Object.keys(positions).filter((s) => (positions[s] ?? 0) > 0);
}

/**
 * Quality filter: reject penny stocks and illiquid names before any strategy logic.
 * Requires price >= $20 AND average daily volume >= 1,000,000 shares.
 */
function isQualityStock(bars: BarData[], symbol = ""): boolean {
  if (bars.length < 5) {
    if (symbol) console.log(`[FILTER] ${symbol} rejected: insufficient bars (${bars.length}<5)`);
    return false;
  }
  const currentPrice = bars[bars.length - 1].c;
  if (currentPrice < MIN_PRICE) {
    if (symbol) console.log(`[FILTER] ${symbol} rejected: price $${currentPrice.toFixed(2)} < $${MIN_PRICE} minimum`);
    return false;
  }
  const lookback = Math.min(20, bars.length);
  const avgVolume = bars.slice(-lookback).reduce((sum, b) => sum + b.v, 0) / lookback;
  if (avgVolume < MIN_AVG_VOLUME) {
    if (symbol) console.log(`[FILTER] ${symbol} rejected: avg volume ${Math.round(avgVolume).toLocaleString()} < ${MIN_AVG_VOLUME.toLocaleString()}`);
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// Exit engine — runs BEFORE any strategy evaluation
// ─────────────────────────────────────────────────────────────
export interface ExitParams {
  stopLossPct: number;     // e.g. 0.07 → exit at -7%
  takeProfitPct: number;   // e.g. 0.12 → exit at +12%
  timeStopDays: number;    // e.g. 10 → exit if held this many days with <timeStopMinGainPct
  timeStopMinGainPct: number; // e.g. 0.02 → must be at least +2% to skip time stop
  enableStopLoss: boolean;
  enableTimeStop: boolean;
}

/** Default exit thresholds per strategy. */
export function getExitParams(strategyId: string): ExitParams {
  switch (strategyId) {
    case "news_trader":
      // News fades fast — tighter risk, shorter horizon.
      return { stopLossPct: 0.05, takeProfitPct: 0.08, timeStopDays: 3, timeStopMinGainPct: 0.02, enableStopLoss: true, enableTimeStop: true };
    case "dca_plus":
      // DCA holds long-term — only take-profit, no stop, no time stop.
      return { stopLossPct: 0, takeProfitPct: 0.15, timeStopDays: 0, timeStopMinGainPct: 0, enableStopLoss: false, enableTimeStop: false };
    default:
      return { stopLossPct: 0.07, takeProfitPct: 0.12, timeStopDays: 10, timeStopMinGainPct: 0.02, enableStopLoss: true, enableTimeStop: true };
  }
}

/**
 * Inspect every open long position. Return the FIRST exit signal that triggers
 * (stop-loss, take-profit, or time-stop). Subsequent ticks will catch the next.
 * Returns null if all positions are healthy.
 *
 * Exit signals carry isExit=true so index.ts bypasses daily-trade-limit
 * and skips AI confirmation — risk management always wins.
 */
export async function managePositions(
  strategyId: string,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number>,
  agentPositionOpenedAt: Record<string, string>,
): Promise<TradeSignal | null> {
  const params = getExitParams(strategyId);
  const now = Date.now();

  for (const symbol of Object.keys(agentPositions)) {
    const heldQty = agentPositions[symbol] ?? 0;
    if (heldQty <= 0) continue;
    const avgCost = agentAvgCost[symbol] ?? 0;
    if (avgCost <= 0) continue;

    const bars = await getDailyBars(symbol, 2);
    if (bars.length === 0) continue;
    const currentPrice = bars[bars.length - 1].c;
    const pnlPct = (currentPrice - avgCost) / avgCost;

    const openedAtStr = agentPositionOpenedAt[symbol];
    const heldMs = openedAtStr ? now - new Date(openedAtStr).getTime() : 0;
    const heldDays = heldMs / 86_400_000;

    const baseSignal = {
      symbol,
      side: "sell" as const,
      notional: heldQty * currentPrice,
      strategyConfidence: 0.95,
      skipAiConfirmation: true,
      isExit: true,
      marketData: { currentPrice },
    };

    // ── Take-profit ──────────────────────────────────────────
    if (params.takeProfitPct > 0 && pnlPct >= params.takeProfitPct) {
      console.log(`[exit] ${symbol} TAKE-PROFIT: pnl=+${(pnlPct * 100).toFixed(1)}% >= +${(params.takeProfitPct * 100).toFixed(0)}%`);
      return {
        ...baseSignal,
        reason: `Take-profit: +${(pnlPct * 100).toFixed(1)}% (target +${(params.takeProfitPct * 100).toFixed(0)}%, avg cost $${avgCost.toFixed(2)})`,
      };
    }

    // ── Stop-loss ────────────────────────────────────────────
    if (params.enableStopLoss && pnlPct <= -params.stopLossPct) {
      console.log(`[exit] ${symbol} STOP-LOSS: pnl=${(pnlPct * 100).toFixed(1)}% <= -${(params.stopLossPct * 100).toFixed(0)}%`);
      return {
        ...baseSignal,
        reason: `Stop-loss: ${(pnlPct * 100).toFixed(1)}% (limit -${(params.stopLossPct * 100).toFixed(0)}%, avg cost $${avgCost.toFixed(2)})`,
      };
    }

    // ── Time-stop ────────────────────────────────────────────
    if (
      params.enableTimeStop &&
      params.timeStopDays > 0 &&
      heldDays >= params.timeStopDays &&
      pnlPct < params.timeStopMinGainPct
    ) {
      console.log(`[exit] ${symbol} TIME-STOP: heldDays=${heldDays.toFixed(1)} >= ${params.timeStopDays} with pnl=${(pnlPct * 100).toFixed(1)}% < +${(params.timeStopMinGainPct * 100).toFixed(0)}%`);
      return {
        ...baseSignal,
        reason: `Time-stop: held ${heldDays.toFixed(1)}d (>=${params.timeStopDays}d) with only +${(pnlPct * 100).toFixed(1)}%`,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// 1. TREND RIDER (momentum_rider)
//    Long-only momentum continuation on the most-actives screener.
//    Entry: price > 20-day SMA, positive SMA slope, volume > 20-day avg,
//           RSI between 40-65, NOT up >4% today (avoid chasing extension).
// ─────────────────────────────────────────────────────────────
export async function momentumRider(
  _config: Record<string, any>,
  agentPositions: Record<string, number>,
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[TrendRider] fetching most-actives universe...";

  let universe = await getMostActives(20);
  if (universe.length === 0) {
    console.warn("[momentumRider] screener returned empty — using fallback universe");
    universe = TREND_FALLBACK;
  }
  universe = universe.slice(0, 15);

  const lookback = 20;
  const diagLines: string[] = [`[TrendRider] universe=${universe.slice(0, 8).join(",")}`];
  let bestSignal: TradeSignal | null = null;
  let bestStrength = 0;

  for (const symbol of universe) {
    if (agentPositions[symbol] && agentPositions[symbol] > 0) {
      diagLines.push(`${symbol}:already_held`);
      continue;
    }

    const bars = await getDailyBars(symbol, lookback + 30);
    if (bars.length < lookback + 5) {
      diagLines.push(`${symbol}:only_${bars.length}_bars`);
      continue;
    }
    if (!isQualityStock(bars, symbol)) {
      diagLines.push(`${symbol}:low_quality`);
      continue;
    }

    const closes = bars.map((b) => b.c);
    const volumes = bars.map((b) => b.v);
    const currentPrice = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2] ?? currentPrice;
    const change1dPct = ((currentPrice - prevClose) / prevClose) * 100;

    const sma20 = calculateSMA(closes.slice(-lookback));
    const avgVol = calculateVolumeMA(volumes.slice(0, -1), lookback);
    const todayVol = volumes[volumes.length - 1];
    const volRatio = avgVol > 0 ? todayVol / avgVol : 0;
    const slope = smaSlope(closes, lookback, 5);
    const rsi = calculateRSI(closes, 14);
    const priceVsSma = (currentPrice - sma20) / sma20;

    // Entry checks — long-only
    const aboveSma = currentPrice > sma20;
    const slopePositive = slope > 0;
    const volBeating = volRatio >= 1.0;
    const rsiInRange = rsi >= 40 && rsi <= 65;
    const notExtended = change1dPct <= 4;

    if (aboveSma && slopePositive && volBeating && rsiInRange && notExtended) {
      diagLines.push(`${symbol}:BUY rsi=${rsi.toFixed(0)} vol=${volRatio.toFixed(1)}x 1d=${change1dPct.toFixed(1)}%`);
      // Strength = combined momentum quality
      const strength = priceVsSma * 0.5 + Math.max(0, slope) * 100 + (volRatio - 1) * 0.2;
      if (strength > bestStrength) {
        bestStrength = strength;
        bestSignal = {
          symbol,
          side: "buy",
          notional: 25, // % of budget; index.ts enforces 25% cap
          reason:
            `[TrendRider] $${currentPrice.toFixed(2)} > SMA20 $${sma20.toFixed(2)} (+${(priceVsSma * 100).toFixed(1)}%), ` +
            `slope+, vol ${volRatio.toFixed(1)}x avg, RSI ${rsi.toFixed(0)} (40-65), today ${change1dPct.toFixed(1)}%`,
          strategyConfidence: Math.min(1, 0.55 + priceVsSma * 4 + (volRatio - 1) * 0.1),
          marketData: { currentPrice, sma: sma20, rsi },
        };
      }
    } else {
      diagLines.push(`${symbol}:no aboveSma=${aboveSma} slope+=${slopePositive} vol=${volRatio.toFixed(1)}x rsi=${rsi.toFixed(0)} 1d=${change1dPct.toFixed(1)}%`);
    }
  }

  _lastStrategyDiagnostics = diagLines.slice(0, 10).join(" | ");
  console.log(`[momentumRider] ${_lastStrategyDiagnostics}`);
  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 2. BARGAIN HUNTER (mean_reversion)
//    Long-only mean reversion on top-losers screener.
//    Entry: down 3-8% today (real dip, not crash), RSI < 35,
//           50-day SMA still rising (not catching a falling knife),
//           reject penny / biotech / meme names via quality filter + price >= $20.
// ─────────────────────────────────────────────────────────────
export async function meanReversion(
  _config: Record<string, any>,
  agentPositions: Record<string, number>,
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[BargainHunter] fetching top-losers universe...";

  let universe = await getTopLosers(20);
  if (universe.length === 0) {
    console.warn("[meanReversion] screener returned empty — using fallback universe");
    universe = REVERT_FALLBACK;
  }
  universe = universe.slice(0, 15);

  const rsiPeriod = 14;
  const diagLines: string[] = [`[BargainHunter] universe=${universe.slice(0, 8).join(",")}`];
  let bestSignal: TradeSignal | null = null;
  let bestRsiDepth = 0;

  for (const symbol of universe) {
    if (agentPositions[symbol] && agentPositions[symbol] > 0) {
      diagLines.push(`${symbol}:already_held`);
      continue;
    }

    const bars = await getDailyBars(symbol, 60);
    if (bars.length < rsiPeriod + 50) {
      diagLines.push(`${symbol}:not_enough_bars`);
      continue;
    }
    if (!isQualityStock(bars, symbol)) {
      diagLines.push(`${symbol}:low_quality`);
      continue;
    }

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2] ?? currentPrice;
    const change1dPct = ((currentPrice - prevClose) / prevClose) * 100;

    const rsi = calculateRSI(closes, rsiPeriod);
    const sma50 = calculateSMA(closes.slice(-50));
    const sma50Prev = calculateSMA(closes.slice(-55, -5));
    const sma50Rising = sma50 > sma50Prev;

    const validDip = change1dPct <= -3 && change1dPct >= -8;
    const oversold = rsi < 35;

    if (validDip && oversold && sma50Rising) {
      const rsiDepth = 35 - rsi;
      diagLines.push(`${symbol}:BUY 1d=${change1dPct.toFixed(1)}% RSI=${rsi.toFixed(0)} sma50_rising`);
      if (rsiDepth > bestRsiDepth) {
        bestRsiDepth = rsiDepth;
        bestSignal = {
          symbol,
          side: "buy",
          notional: 25,
          reason:
            `[BargainHunter] $${currentPrice.toFixed(2)} dropped ${change1dPct.toFixed(1)}% today, RSI ${rsi.toFixed(0)} (<35), ` +
            `50d SMA still rising ($${sma50.toFixed(2)} > $${sma50Prev.toFixed(2)}) — quality dip`,
          strategyConfidence: Math.min(1, 0.55 + rsiDepth / 30 + 0.05),
          marketData: { currentPrice, rsi },
        };
      }
    } else {
      diagLines.push(`${symbol}:no 1d=${change1dPct.toFixed(1)}% rsi=${rsi.toFixed(0)} sma50_rising=${sma50Rising}`);
    }
  }

  _lastStrategyDiagnostics = diagLines.slice(0, 10).join(" | ");
  console.log(`[meanReversion] ${_lastStrategyDiagnostics}`);
  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 3. NEWS TRADER (news_trader)
//    Long-only pure sentiment trade.
//    Entry: sentiment > 0.5, price >= $20, vol >= 500K (looser vol — news names are events).
//    Max 2 news entries/day enforced by index.ts daily trade limit.
//    Exits centralized in managePositions with tighter thresholds.
// ─────────────────────────────────────────────────────────────
export async function newsTrader(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[NewsTrader] fetching global news stream...";

  // News Trader uses 0.5 sentiment threshold by default (stronger conviction).
  // config.sentiment_threshold stored as integer tenths (e.g. 5 → 0.5).
  const sentimentThreshold = Number(config.sentiment_threshold ?? 5) / 10;
  const held = heldSymbols(agentPositions);

  const rawNews = await getAllNews(50);
  if (rawNews.length === 0) {
    _lastStrategyDiagnostics = "[NewsTrader] no news articles returned from API";
    console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);
    return null;
  }

  const headlinesBySymbol: Record<string, string[]> = {};
  for (const article of rawNews) {
    if (!article.headline) continue;
    for (const sym of article.symbols) {
      if (!headlinesBySymbol[sym]) headlinesBySymbol[sym] = [];
      headlinesBySymbol[sym].push(article.headline);
    }
  }

  const symbolCount = Object.keys(headlinesBySymbol).length;
  _lastStrategyDiagnostics = `[NewsTrader] ${rawNews.length} articles, ${symbolCount} symbols`;

  if (symbolCount === 0) {
    console.log(`[newsTrader] ${_lastStrategyDiagnostics} — no tagged symbols`);
    return null;
  }

  const decision = await newsTraderDecision({
    headlinesBySymbol,
    heldSymbols: held,
    sentimentThreshold,
  });

  // Long-only: only "buy" decisions emit signals. "sell" decisions could close
  // an existing long, but exits are handled by managePositions, so we ignore.
  if (!decision.execute || !decision.symbol || decision.side !== "buy") {
    _lastStrategyDiagnostics += ` | no buy signal (score=${(decision.sentiment_score ?? 0).toFixed(2)})`;
    console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);
    return null;
  }

  if (decision.sentiment_score < sentimentThreshold) {
    _lastStrategyDiagnostics += ` | score ${decision.sentiment_score.toFixed(2)} below threshold ${sentimentThreshold}`;
    console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);
    return null;
  }

  if ((agentPositions[decision.symbol] ?? 0) > 0) {
    _lastStrategyDiagnostics += ` | already long ${decision.symbol}`;
    return null;
  }

  const bars = await getDailyBars(decision.symbol, 25);
  if (bars.length === 0) return null;
  const currentPrice = bars[bars.length - 1].c;

  // News-trader uses a slightly looser quality filter: $20 price, 500K vol
  // (news names are often event-driven and can lack institutional volume).
  if (currentPrice < MIN_PRICE) {
    _lastStrategyDiagnostics += ` | ${decision.symbol} price $${currentPrice.toFixed(2)} < $${MIN_PRICE}`;
    return null;
  }
  const lookback = Math.min(20, bars.length);
  const avgVol = bars.slice(-lookback).reduce((s, b) => s + b.v, 0) / lookback;
  if (avgVol < 500_000) {
    _lastStrategyDiagnostics += ` | ${decision.symbol} vol ${Math.round(avgVol).toLocaleString()} < 500k`;
    return null;
  }

  const headlines = (headlinesBySymbol[decision.symbol] ?? []).slice(0, 3);
  const headlineText = headlines.map((h) => h.slice(0, 80)).join(" | ");

  _lastStrategyDiagnostics += ` | BUY ${decision.symbol} score=${decision.sentiment_score.toFixed(2)}`;
  console.log(`[newsTrader] ${_lastStrategyDiagnostics}`);

  return {
    symbol: decision.symbol,
    side: "buy",
    notional: 20, // 20% of budget — news catalysts justify a meaningful size
    reason: `[NewsTrader] sentiment ${decision.sentiment_score.toFixed(2)} — ${decision.reasoning} | ${headlineText}`,
    strategyConfidence: decision.confidence,
    skipAiConfirmation: true,
    marketData: { currentPrice, sentimentScore: decision.sentiment_score },
  };
}

// ─────────────────────────────────────────────────────────────
// 4. BLIND QUANT (blind_quant)
//    12 anonymized features per asset + SPY market regime.
//    Pre-filter to top 5 most-promising assets before sending to Groq.
//    Long-only.
// ─────────────────────────────────────────────────────────────
export async function blindQuant(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[BlindQuant] fetching most-actives universe...";

  let universe = await getMostActives(20);
  if (universe.length === 0) {
    console.warn("[blindQuant] screener returned empty — using fallback universe");
    universe = TREND_FALLBACK;
  }
  universe = universe.slice(0, 20);

  const minConfidence = Number(config.min_confidence ?? 7) / 10; // 0.70 default

  // Build asset feature vectors for the full universe...
  type ScoredAsset = { symbol: string; features: AnonAsset; score: number };
  const scored: ScoredAsset[] = [];

  for (const symbol of universe) {
    // Need ~260 bars for 52-week distance + 30 bars for ATR/RSI/etc.
    const bars = await getDailyBars(symbol, 260);
    if (bars.length < 60) continue;
    if (!isQualityStock(bars, symbol)) continue;

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

    const ret20 = closes.slice(-21);
    const rets = ret20.slice(1).map((c, i) => (c - ret20[i]) / ret20[i]);
    const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
    const vol20 = Math.sqrt(rets.reduce((a, r) => a + (r - mu) ** 2, 0) / rets.length);

    const slope = smaSlope(closes, 20, 5);
    const dist52wHigh = distanceFromHighPct(closes, 252);
    const dist52wLow = distanceFromLowPct(closes, 252);
    const atr14 = calculateATR(highs, lows, closes, 14);

    const features: AnonAsset = {
      asset_id: "",
      price_change_1d_pct: Number(change1d.toFixed(3)),
      price_change_5d_pct: Number(change5d.toFixed(3)),
      price_change_20d_pct: Number(change20d.toFixed(3)),
      volume_vs_avg_20d: Number(volRatio.toFixed(3)),
      rsi_14: Number(rsi14.toFixed(1)),
      bollinger_position: Number(bbPos.toFixed(3)),
      volatility_20d: Number(vol20.toFixed(4)),
      sma_20_slope: Number(slope.toFixed(5)),
      distance_from_52w_high_pct: Number(dist52wHigh.toFixed(2)),
      distance_from_52w_low_pct: Number(dist52wLow.toFixed(2)),
      atr_14: Number(atr14.toFixed(3)),
    };

    // Heuristic pre-filter score: trend up + vol surge - extension penalty.
    const score =
      change5d * 0.4 +
      change20d * 0.2 +
      (volRatio - 1) * 5 +
      (slope > 0 ? 2 : -2) +
      (rsi14 > 70 ? -3 : 0) +
      (rsi14 < 30 ? 2 : 0);

    scored.push({ symbol, features, score });
  }

  // Pre-filter: top 5 by score, then rename to Asset_A..E
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  const assetIdToSymbol: Record<string, string> = {};
  const assets: AnonAsset[] = top.map((s, i) => {
    const id = `Asset_${String.fromCharCode(65 + i)}`;
    assetIdToSymbol[id] = s.symbol;
    return { ...s.features, asset_id: id };
  });

  _lastStrategyDiagnostics =
    `[BlindQuant] universe=${universe.slice(0, 8).join(",")} top5=${top.map((s) => s.symbol).join(",")}`;

  if (assets.length === 0) {
    console.log(`[blindQuant] ${_lastStrategyDiagnostics} — no data`);
    return null;
  }

  // SPY market regime — sent to Groq alongside the asset block.
  const spyBars = await getDailyBars("SPY", 3);
  const spyChange = spyBars.length >= 2
    ? ((spyBars[spyBars.length - 1].c - spyBars[spyBars.length - 2].c) / spyBars[spyBars.length - 2].c) * 100
    : 0;

  const heldAssetIds = Object.entries(assetIdToSymbol)
    .filter(([, sym]) => (agentPositions[sym] ?? 0) > 0)
    .map(([id]) => id);

  const decision = await blindQuantDecision({
    assets,
    heldAssetIds,
    minConfidence,
    spyChange1dPct: spyChange,
  });

  if (!decision.execute || !decision.asset_id || decision.confidence < minConfidence) {
    _lastStrategyDiagnostics += ` | no signal (conf=${(decision.confidence ?? 0).toFixed(2)})`;
    console.log(`[blindQuant] ${_lastStrategyDiagnostics}`);
    return null;
  }

  const symbol = assetIdToSymbol[decision.asset_id];
  if (!symbol) return null;
  const heldQty = agentPositions[symbol] ?? 0;

  // Long-only: only emit buys on un-held names; "sell" exits are handled centrally.
  if (decision.side !== "buy") {
    _lastStrategyDiagnostics += ` | side=${decision.side} ignored (exits centralized)`;
    return null;
  }
  if (heldQty > 0) return null;

  // Bear-market regime block: SPY -1.5%+ → no new longs.
  if (spyChange < -1.5) {
    _lastStrategyDiagnostics += ` | bear market SPY ${spyChange.toFixed(1)}% — new long blocked`;
    console.log(`[blindQuant] ${_lastStrategyDiagnostics}`);
    return null;
  }

  const bars = await getDailyBars(symbol, 2);
  if (bars.length === 0) return null;
  const currentPrice = bars[bars.length - 1].c;
  const anonAsset = assets.find((a) => a.asset_id === decision.asset_id);

  _lastStrategyDiagnostics +=
    ` | BUY ${decision.asset_id}→${symbol} conf=${decision.confidence.toFixed(2)} SPY=${spyChange.toFixed(1)}%`;
  console.log(`[blindQuant] ${_lastStrategyDiagnostics}`);

  return {
    symbol,
    side: "buy",
    notional: 20,
    reason: `[BlindQuant] ${decision.asset_id}→${symbol} | ${decision.reasoning} | data=${JSON.stringify(anonAsset)}`,
    strategyConfidence: decision.confidence,
    skipAiConfirmation: true,
    marketData: { currentPrice },
  };
}

// ─────────────────────────────────────────────────────────────
// 5. SMART DCA (dca_plus)
//    Only SPY / QQQ / VTI.
//    Once-per-day-per-symbol gate.
//    Tiered buy sizing: 3-5% dip → 10% of budget, 5-7% dip → 20%, 7%+ → 30%.
//    Take-profit at +15%. No stop loss. No time stop.
// ─────────────────────────────────────────────────────────────
export async function dcaPlus(
  _config: Record<string, any>,
  agentPositions: Record<string, number>,
  _agentAvgCost: Record<string, number> = {},
  _agentPositionOpenedAt: Record<string, string> = {},
  agentLastBuyAt: Record<string, string> = {},
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = `[SmartDCA] universe=${DCA_SYMBOLS.join(",")}`;

  // Once-per-day-per-symbol gate
  const today = new Date().toISOString().slice(0, 10);
  let bestSignal: TradeSignal | null = null;
  let bestDip = -Infinity;

  for (const symbol of DCA_SYMBOLS) {
    // Day-gate: skip if this symbol was already bought today
    const lastBuy = agentLastBuyAt[symbol];
    if (lastBuy && lastBuy.slice(0, 10) === today) {
      _lastStrategyDiagnostics += ` | ${symbol}:already_bought_today`;
      continue;
    }

    const bars = await getDailyBars(symbol, 22);
    if (bars.length < 10) continue;

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];
    const avg20 = calculateSMA(closes.slice(0, -1));
    const dip = dipPercent(currentPrice, avg20);
    const heldQty = agentPositions[symbol] ?? 0;

    // Tiered sizing — only buy on a meaningful dip
    let sizePct = 0;
    if (dip >= 7) sizePct = 30;
    else if (dip >= 5) sizePct = 20;
    else if (dip >= 3) sizePct = 10;

    if (sizePct === 0) {
      // Schedule baseline DCA only if we don't already hold and haven't bought today
      if (heldQty === 0) {
        sizePct = 10;
      } else {
        continue;
      }
    }

    if (dip > bestDip) {
      bestDip = dip;
      const isDip = dip >= 3;
      bestSignal = {
        symbol,
        side: "buy",
        notional: sizePct,
        reason: isDip
          ? `[SmartDCA] ${dip.toFixed(2)}% dip below 20d avg $${avg20.toFixed(2)} → ${sizePct}% of budget`
          : `[SmartDCA] baseline DCA into ${symbol}: ${dip.toFixed(2)}% vs avg → ${sizePct}% of budget`,
        strategyConfidence: isDip ? 0.85 : 0.72,
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
//    Long-only fair-value vs market price mispricing trades.
//    Entry: AI fair-value > 10% above current price AND conf >= 0.75.
//    Position size scales: 15% at conf 0.75 → 25% at conf 0.90.
// ─────────────────────────────────────────────────────────────
export async function predictionArb(
  _config: Record<string, any>,
  agentPositions: Record<string, number>,
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[PredictionPro] fetching most-actives + news...";

  let universe = await getMostActives(10);
  if (universe.length === 0) universe = TREND_FALLBACK.slice(0, 10);

  const rawNews = await getAllNews(30);
  const newsSymbols = new Set<string>();
  for (const article of rawNews) {
    for (const sym of article.symbols) newsSymbols.add(sym);
  }
  const withNews = universe.filter((s) => newsSymbols.has(s));
  const withoutNews = universe.filter((s) => !newsSymbols.has(s));
  const sample = [...withNews, ...withoutNews].slice(0, 5);

  _lastStrategyDiagnostics =
    `[PredictionPro] active=${universe.slice(0, 6).join(",")} withNews=${withNews.join(",") || "none"}`;

  let bestSignal: TradeSignal | null = null;
  let bestEdge = 0;

  for (const symbol of sample) {
    if ((agentPositions[symbol] ?? 0) > 0) continue;

    const bars = await getDailyBars(symbol, 25);
    if (bars.length < 10) continue;
    if (!isQualityStock(bars, symbol)) continue;

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];
    const rsi = calculateRSI(closes, 14);
    const mom5d = momentumPct(closes, 5);

    const { direction, confidence, marketProbability, reasoning } = await evalMispricing({
      symbol,
      currentPrice,
      rsi,
      momentum5d: mom5d,
    });

    if (direction !== "buy") continue;
    if (confidence < 0.75) continue;
    const edge = confidence - marketProbability;
    if (edge < 0.10) continue;
    if (edge <= bestEdge) continue;

    // Size scales linearly with confidence: 0.75 → 15%, 0.90 → 25%.
    const scale = Math.min(1, Math.max(0, (confidence - 0.75) / 0.15));
    const sizePct = 15 + scale * 10;
    const hasCatalyst = newsSymbols.has(symbol);

    bestEdge = edge;
    bestSignal = {
      symbol,
      side: "buy",
      notional: sizePct,
      reason:
        `[PredictionPro] AI ${(confidence * 100).toFixed(0)}% vs market ${(marketProbability * 100).toFixed(0)}% ` +
        `(edge ${(edge * 100).toFixed(0)}%, size ${sizePct.toFixed(0)}%): ${reasoning}` +
        (hasCatalyst ? " [news catalyst]" : ""),
      strategyConfidence: confidence,
      marketData: { currentPrice, rsi },
    };
  }

  _lastStrategyDiagnostics += ` | bestEdge=${bestEdge.toFixed(2)}`;
  console.log(`[predictionArb] ${_lastStrategyDiagnostics}`);
  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 7. YOUR RULES (custom)
//    User's plain-English strategy_prompt evaluated by Groq.
//    Global rules apply (long-only, $20/1M, 25%, conf 0.70).
// ─────────────────────────────────────────────────────────────
export async function customStrategy(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
): Promise<TradeSignal | null> {
  const strategyPrompt = (config.strategy_prompt as string | undefined)?.trim().slice(0, 500);
  if (!strategyPrompt || strategyPrompt.length < 10) {
    _lastStrategyDiagnostics = "[YourRules] no strategy_prompt configured — skipping";
    console.warn(`[customStrategy] ${_lastStrategyDiagnostics}`);
    return null;
  }

  _lastStrategyDiagnostics = "[YourRules] fetching most-actives universe...";

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
      if (!isQualityStock(bars, symbol)) continue;
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

  if (!execute || !symbol || confidence < AI_CONFIDENCE_FLOOR) {
    _lastStrategyDiagnostics += ` | no signal (conf=${(confidence ?? 0).toFixed(2)})`;
    console.log(`[customStrategy] ${_lastStrategyDiagnostics}`);
    return null;
  }

  // Long-only: only emit buy signals on un-held names. Sells handled by exit engine.
  if (side !== "buy") {
    _lastStrategyDiagnostics += ` | side=${side} ignored (exits centralized)`;
    return null;
  }

  const symbolData = marketData.find((d) => d.symbol === symbol);
  if (!symbolData) return null;
  if ((agentPositions[symbol] ?? 0) > 0) return null;

  _lastStrategyDiagnostics += ` | BUY ${symbol} conf=${confidence.toFixed(2)}`;
  console.log(`[customStrategy] ${_lastStrategyDiagnostics}`);

  return {
    symbol,
    side: "buy",
    notional: 20,
    reason: `[YourRules] confidence ${(confidence * 100).toFixed(0)}%: ${reasoning}`,
    strategyConfidence: confidence,
    marketData: { currentPrice: symbolData.currentPrice, rsi: symbolData.rsi14 },
  };
}

// ─────────────────────────────────────────────────────────────
// 8. STRATEGY LAB (strategy_lab)
//    Meta-learning agent. Executes graduated rules always (no time gate).
//    Bootstraps with simple long-only rules until evolution graduates a ruleset.
// ─────────────────────────────────────────────────────────────
async function strategyLab(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
): Promise<TradeSignal | null> {
  _lastStrategyDiagnostics = "[strategy_lab] running";

  // Bootstrap ruleset — long-only, aligns with global filters ($20, 1M vol, max 3).
  const DEFAULT_BOOTSTRAP_RULES =
    "Buy large-cap stocks (price above $20, daily volume over 1M) showing 5-day momentum >3% " +
    "with RSI between 40-65 (not overbought). Avoid stocks up more than 4% today. " +
    "Prefer S&P 500 names with consistent uptrends. Long-only — never short.";

  const bestRules = (config.best_rules as string | undefined) ?? DEFAULT_BOOTSTRAP_RULES;
  if (!config.best_rules) {
    console.log("[strategy_lab] No graduated rules yet — using bootstrap ruleset");
    _lastStrategyDiagnostics += " | bootstrapping with default rules";
  }

  return customStrategy(
    { ...config, strategy_prompt: bestRules },
    agentPositions,
  );
}

// ─────────────────────────────────────────────────────────────
// Router — dispatches to the correct strategy function.
// All strategies share the same long-only signature now.
// ─────────────────────────────────────────────────────────────
export async function runStrategy(
  strategyId: string,
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {},
  agentPositionOpenedAt: Record<string, string> = {},
  agentLastBuyAt: Record<string, string> = {},
): Promise<TradeSignal | null> {
  switch (strategyId) {
    case "momentum_rider":
      return momentumRider(config, agentPositions);
    case "mean_reversion":
      return meanReversion(config, agentPositions);
    case "prediction_arb":
      return predictionArb(config, agentPositions);
    case "dca_plus":
      return dcaPlus(config, agentPositions, agentAvgCost, agentPositionOpenedAt, agentLastBuyAt);
    case "custom":
      return customStrategy(config, agentPositions);
    case "news_trader":
      return newsTrader(config, agentPositions);
    case "blind_quant":
      return blindQuant(config, agentPositions);
    case "strategy_lab":
      return strategyLab(config, agentPositions);
    default:
      console.warn(`[runStrategy] Unknown strategy: ${strategyId}`);
      return null;
  }
}
