import { getDailyBars as _getDailyBars, getLatestPrice, getNews, getNewsBulk } from "./alpaca.ts";
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

// Last-run strategy diagnostics — written by strategy functions, read by index.ts
// to populate ai_reasoning even when no signal is generated.
let _lastStrategyDiagnostics = "";
export function getLastStrategyDiagnostics(): string { return _lastStrategyDiagnostics; }

/** Drop-in replacement for getDailyBars that serves from the in-memory cache. */
async function getDailyBars(symbol: string, count: number): Promise<BarData[]> {
  const cached = _barsCache.get(symbol);
  if (cached && cached.length >= count) return cached.slice(-count);
  const bars = await _getDailyBars(symbol, count);
  if (!cached || bars.length > cached.length) _barsCache.set(symbol, bars);
  return bars;
}

// Expanded watchlist: 15 liquid, diversified names
const WATCHLIST = [
  "SPY", "QQQ",
  "AAPL", "MSFT", "NVDA", "TSLA", "AMZN",
  "GOOGL", "META", "AMD",
  "NFLX", "JPM", "V", "UNH", "COST",
];

const DCA_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "COST"];

// Pairs that should not both be held simultaneously (high correlation)
const CORRELATED_PAIRS: [string, string][] = [
  ["AAPL", "MSFT"],
  ["SPY",  "QQQ"],
  ["NVDA", "AMD"],
  ["GOOGL", "META"],
  ["AMZN", "COST"],
  ["JPM",  "V"],
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
type TimeHorizon = "fast" | "medium" | "slow";

function resolveHorizon(config: Record<string, any>): TimeHorizon {
  const h = config.time_horizon as string | undefined;
  if (h === "fast" || h === "slow") return h;
  return "medium";
}

/**
 * Returns multipliers that loosen strategy filters:
 *   aggressive_mode=true  → significant loosening (halve the distance to neutral)
 *   _loosen=1 (3+ consecutive no-signal runs) → 10 % looser
 *   default → normal thresholds
 */
function signalMode(config: Record<string, any>): { aggressive: boolean; loosen: boolean } {
  return {
    aggressive: Boolean(config.aggressive_mode),
    loosen:     Number(config._loosen) > 0,
  };
}

function heldSymbols(positions: Record<string, number>): string[] {
  return Object.keys(positions).filter((s) => (positions[s] ?? 0) > 0);
}

/** Returns true when buying `symbol` would conflict with an existing correlated position. */
function isCorrelated(symbol: string, held: string[]): boolean {
  return CORRELATED_PAIRS.some(
    ([a, b]) =>
      (a === symbol && held.includes(b)) ||
      (b === symbol && held.includes(a))
  );
}

// ─────────────────────────────────────────────────────────────
// 1. MOMENTUM RIDER
//    Buy when price breaks above SMA with volume + trend confirmation.
//    Trailing stop: sell if price drops >2% from the lookback-period high.
//    "Don't chase": skip if price is >5% above SMA (overextended).
// ─────────────────────────────────────────────────────────────
export async function momentumRider(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const lookback = horizon === "fast" ? 9 : horizon === "slow" ? 50 : 20;
  const positionSizePct = horizon === "fast" ? 5 : horizon === "slow" ? 15 : 10;
  const volPeriod = 20;
  const held = heldSymbols(agentPositions);

  let bestSignal: TradeSignal | null = null;
  let bestStrength = 0;
  const diagLines: string[] = [];

  for (const symbol of WATCHLIST) {
    const bars = await getDailyBars(symbol, lookback + volPeriod + 5);
    if (bars.length < lookback + 5) {
      diagLines.push(`${symbol}: only ${bars.length} bars (need ${lookback + 5})`);
      continue;
    }

    const closes = bars.map((b) => b.c);
    const volumes = bars.map((b) => b.v);
    const sma = calculateSMA(closes.slice(-lookback));
    const currentPrice = closes[closes.length - 1];
    const heldQty = agentPositions[symbol] ?? 0;

    const { aggressive, loosen } = signalMode(config);

    // Volume confirmation — 1.2× avg (aggressive: 0.8×, loosen: 1.0×)
    const volRequired = aggressive ? 0.8 : loosen ? 1.0 : 1.2;
    const avgVol = calculateVolumeMA(volumes.slice(0, -1), volPeriod);
    const todayVol = volumes[volumes.length - 1];
    const volumeConfirmed = avgVol > 0 && todayVol >= avgVol * volRequired;
    const volRatio = avgVol > 0 ? todayVol / avgVol : 0;

    // SMA slope: positive = uptrend (aggressive allows slight negative slope)
    const slope = smaSlope(closes, lookback, Math.min(5, Math.floor(lookback / 3)));
    const slopeMin = aggressive ? -0.001 : loosen ? -0.0003 : 0;
    const trendUp = slope >= slopeMin;

    const priceVsSma = (currentPrice - sma) / sma;

    // Buy when within 1% of SMA (aggressive: 2%), i.e. price needn't be above yet
    const smaBuffer = aggressive ? 0.02 : loosen ? 0.015 : 0.01;

    if (currentPrice >= sma * (1 - smaBuffer) && heldQty === 0) {
      // Filters: volume, trend, not overextended, not correlated
      if (!volumeConfirmed) {
        diagLines.push(`${symbol}: $${currentPrice.toFixed(2)} SMA=${sma.toFixed(2)} vol=${volRatio.toFixed(2)}x<${volRequired}x→low_vol`);
        continue;
      }
      if (!trendUp) {
        diagLines.push(`${symbol}: $${currentPrice.toFixed(2)} SMA=${sma.toFixed(2)} slope=${slope.toFixed(5)}<${slopeMin}→no_trend`);
        continue;
      }
      const overextendedCap = aggressive ? 0.08 : 0.05;
      if (priceVsSma > overextendedCap) {
        diagLines.push(`${symbol}: $${currentPrice.toFixed(2)} overextended ${(priceVsSma * 100).toFixed(1)}%>cap ${(overextendedCap * 100).toFixed(0)}%`);
        continue;
      }
      if (isCorrelated(symbol, held)) {
        diagLines.push(`${symbol}: correlated with held position`);
        continue;
      }

      diagLines.push(`${symbol}: BUY signal priceVsSma=${(priceVsSma * 100).toFixed(2)}% vol=${volRatio.toFixed(2)}x`);
      const strength = priceVsSma;
      if (strength > bestStrength) {
        bestStrength = strength;
        bestSignal = {
          symbol,
          side: "buy",
          notional: positionSizePct,
          reason:
            `Price $${currentPrice.toFixed(2)} is ${(priceVsSma * 100).toFixed(2)}% above SMA(${lookback}) $${sma.toFixed(2)}, ` +
            `volume ${volRatio.toFixed(1)}× avg, trend rising [${horizon}]`,
          strategyConfidence: Math.min(1, strength * 8 + 0.3),
          marketData: { currentPrice, sma },
        };
      }
    } else if (heldQty > 0) {
      // Exit: SMA breakdown OR trailing stop (>2% below lookback-period high)
      const recentHigh = periodHigh(closes.slice(-lookback), lookback);
      const dropFromHigh = recentHigh > 0 ? (recentHigh - currentPrice) / recentHigh : 0;
      const trailingStopHit = dropFromHigh > 0.02;
      const smaBreach = currentPrice < sma * 0.999;

      if (smaBreach || trailingStopHit) {
        const strength = Math.max(Math.abs(priceVsSma), dropFromHigh);
        if (strength > bestStrength) {
          bestStrength = strength;
          bestSignal = {
            symbol,
            side: "sell",
            notional: heldQty * currentPrice,
            reason: trailingStopHit
              ? `Trailing stop: price $${currentPrice.toFixed(2)} dropped ${(dropFromHigh * 100).toFixed(1)}% from ${lookback}-day high $${recentHigh.toFixed(2)} [${horizon}]`
              : `SMA breach: price $${currentPrice.toFixed(2)} dropped ${(Math.abs(priceVsSma) * 100).toFixed(2)}% below SMA(${lookback}) $${sma.toFixed(2)} [${horizon}]`,
            strategyConfidence: Math.min(1, strength * 5),
            marketData: { currentPrice, sma },
          };
        }
      }
    } else {
      // heldQty === 0 and price below SMA entry range
      diagLines.push(`${symbol}: $${currentPrice.toFixed(2)} too far below SMA ${sma.toFixed(2)} (${(priceVsSma * 100).toFixed(2)}% vs -${(smaBuffer * 100).toFixed(1)}% floor)`);
    }
  }

  _lastStrategyDiagnostics = diagLines.slice(0, 10).join(" | ");
  console.log(`[momentumRider] ${_lastStrategyDiagnostics}`);

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 2. MEAN REVERSION
//    Buy when: RSI oversold + price below lower Bollinger Band + 50-day uptrend.
//    Scale in: add 50% more if RSI drops to <20.
//    Scale out: take 50% profit at RSI=50, exit fully at RSI>overbought.
// ─────────────────────────────────────────────────────────────
export async function meanReversion(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const { aggressive, loosen } = signalMode(config);
  const rsiPeriod = horizon === "fast" ? 7 : horizon === "slow" ? 21 : 14;

  // Base RSI thresholds (widened vs original to find more signals):
  //   buy at RSI<40, sell at RSI>60 (originally 30/70)
  const rsiOversoldBase   = horizon === "fast" ? 35 : horizon === "slow" ? 45 : 40;
  const rsiOverboughtBase = horizon === "fast" ? 65 : horizon === "slow" ? 55 : 60;
  // Aggressive halves the remaining distance to neutral (50)
  const rsiOversold   = aggressive ? rsiOversoldBase + 5 : loosen ? rsiOversoldBase + 4 : rsiOversoldBase;
  const rsiOverbought = aggressive ? rsiOverboughtBase - 5 : loosen ? rsiOverboughtBase - 4 : rsiOverboughtBase;

  const positionSizePct = horizon === "fast" ? 5 : horizon === "slow" ? 15 : 10;

  // Need enough bars for RSI + Bollinger + 50-day trend check
  const barsNeeded = Math.max(rsiPeriod * 3, 60);
  const held = heldSymbols(agentPositions);

  let bestSignal: TradeSignal | null = null;
  let bestExtreme = 0;

  for (const symbol of WATCHLIST) {
    const bars = await getDailyBars(symbol, barsNeeded);
    if (bars.length < rsiPeriod + 1) continue;

    const closes = bars.map((b) => b.c);
    const rsi = calculateRSI(closes, rsiPeriod);
    const currentPrice = closes[closes.length - 1];
    const heldQty = agentPositions[symbol] ?? 0;

    // Bollinger Band confirmation
    const bb = calculateBollingerBands(closes, 20, 2);

    // 50-day trend: only buy reversions in overall uptrends (avoid falling knives)
    const sma50 = closes.length >= 50 ? calculateSMA(closes.slice(-50)) : null;
    const sma50Prev = closes.length >= 55 ? calculateSMA(closes.slice(-55, -5)) : null;
    const inUptrend = sma50 !== null && sma50Prev !== null && sma50 > sma50Prev;

    if (rsi < rsiOversold && heldQty === 0) {
      // Entry filters: below (or near) lower BB + in uptrend + not correlated
      // Aggressive: allow up to 5% above lower band; loosen: 2%; default: 0%
      const bbSlack = aggressive ? 1.05 : loosen ? 1.02 : 1.0;
      if (currentPrice > bb.lower * bbSlack) continue;
      if (!inUptrend && !aggressive) continue; // aggressive skips uptrend filter
      if (isCorrelated(symbol, held)) continue;

      const extreme = rsiOversold - rsi;
      if (extreme > bestExtreme) {
        bestExtreme = extreme;
        bestSignal = {
          symbol,
          side: "buy",
          notional: positionSizePct,
          reason:
            `RSI(${rsiPeriod})=${rsi.toFixed(1)} oversold below ${rsiOversold}, ` +
            `price $${currentPrice.toFixed(2)} below BB lower $${bb.lower.toFixed(2)}, 50-day uptrend confirmed [${horizon}]`,
          strategyConfidence: Math.min(1, extreme / 20 + 0.3),
          marketData: { currentPrice, rsi },
        };
      }
    } else if (rsi < 20 && heldQty > 0) {
      // Extremely oversold while holding → scale in (add 50% of normal size)
      if (!isCorrelated(symbol, held)) {
        const extreme = 20 - rsi;
        if (extreme > bestExtreme) {
          bestExtreme = extreme + 5; // boost priority
          bestSignal = {
            symbol,
            side: "buy",
            notional: Math.floor(positionSizePct * 0.5),
            reason: `RSI(${rsiPeriod})=${rsi.toFixed(1)} extremely oversold — scaling in 50% additional position [${horizon}]`,
            strategyConfidence: 0.80,
            marketData: { currentPrice, rsi },
          };
        }
      }
    } else if (heldQty > 0) {
      if (rsi > rsiOverbought) {
        // Full exit at overbought
        const extreme = rsi - rsiOverbought;
        if (extreme > bestExtreme) {
          bestExtreme = extreme;
          bestSignal = {
            symbol,
            side: "sell",
            notional: heldQty * currentPrice, // full position
            reason: `RSI(${rsiPeriod})=${rsi.toFixed(1)} overbought above ${rsiOverbought} — full exit [${horizon}]`,
            strategyConfidence: Math.min(1, extreme / 20 + 0.3),
            marketData: { currentPrice, rsi },
          };
        }
      } else if (rsi > 50) {
        // Partial exit: take 50% profit as RSI crosses mid-point
        const partialQty = Math.floor(heldQty * 0.5);
        if (partialQty > 0) {
          const extreme = rsi - 50;
          if (extreme > bestExtreme) {
            bestExtreme = extreme;
            bestSignal = {
              symbol,
              side: "sell",
              notional: partialQty * currentPrice, // sell half
              reason: `RSI(${rsiPeriod})=${rsi.toFixed(1)} crossed above 50 — taking 50% profit [${horizon}]`,
              strategyConfidence: 0.65,
              marketData: { currentPrice, rsi },
            };
          }
        }
      }
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 3. PREDICTION ARBITRAGE (Prediction Pro)
//    Kelly Criterion: only trade when AI confidence – market probability > 15%.
//    Position size scales with Kelly edge.
// ─────────────────────────────────────────────────────────────
export async function predictionArb(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const confidenceThreshold = horizon === "fast" ? 0.60 : horizon === "slow" ? 0.80 : 0.70;
  const held = heldSymbols(agentPositions);

  let bestSignal: TradeSignal | null = null;
  let bestEdge = 0;

  // Sample 4 random symbols to reduce API load
  const sample = [...WATCHLIST].sort(() => Math.random() - 0.5).slice(0, 4);

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

    if (direction === "hold") continue;
    if (confidence < confidenceThreshold) continue;

    // Kelly edge: only trade when gap between AI confidence and market is >15%
    const edge = confidence - marketProbability;
    if (edge < 0.15) continue;
    if (edge <= bestEdge) continue;

    // Kelly position sizing: bet proportionally to edge (capped at 15%)
    const kellyFraction = edge / Math.max(0.01, 1 - marketProbability);
    const kellySizePct = Math.min(15, Math.max(2, kellyFraction * 20));

    if (direction === "buy" && heldQty === 0 && !isCorrelated(symbol, held)) {
      bestEdge = edge;
      bestSignal = {
        symbol,
        side: "buy",
        notional: kellySizePct,
        reason:
          `Mispricing: AI ${(confidence * 100).toFixed(0)}% vs market ${(marketProbability * 100).toFixed(0)}% ` +
          `(Kelly edge ${(edge * 100).toFixed(0)}%, size ${kellySizePct.toFixed(1)}%): ${reasoning} [${horizon}]`,
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
          `Overpriced: AI ${(confidence * 100).toFixed(0)}% vs market ${(marketProbability * 100).toFixed(0)}% ` +
          `(edge ${(edge * 100).toFixed(0)}%): ${reasoning} [${horizon}]`,
        strategyConfidence: confidence,
        marketData: { currentPrice, rsi },
      };
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 5. DCA+
//    Smarter dip detection: proportional size at 3%/5%/8% dips.
//    Market fear bonus: SPY down >2% → increase buy size 1.5×.
//    Take-profit: sell when up 10% from avg cost.
// ─────────────────────────────────────────────────────────────
export async function dcaPlus(
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {}
): Promise<TradeSignal | null> {
  const horizon = resolveHorizon(config);
  const baseAmount = Number(config.base_amount ?? 100);
  const dipMultiplier = Number(config.dip_multiplier ?? 2);

  // Check market fear: SPY down >2% today
  let marketFear = false;
  const spyBars = await getDailyBars("SPY", 3);
  if (spyBars.length >= 2) {
    const spyChange =
      ((spyBars[spyBars.length - 1].c - spyBars[spyBars.length - 2].c) /
        spyBars[spyBars.length - 2].c) *
      100;
    marketFear = spyChange < -2;
  }

  // ── Take-profit check: sell any DCA symbol up 10% from avg cost ────
  for (const symbol of DCA_SYMBOLS) {
    const heldQty = agentPositions[symbol] ?? 0;
    if (heldQty <= 0) continue;
    const avgCost = agentAvgCost[symbol] ?? 0;
    if (avgCost === 0) continue;

    const bars = await getDailyBars(symbol, 2);
    if (bars.length === 0) continue;
    const price = bars[bars.length - 1].c;
    const gainPct = ((price - avgCost) / avgCost) * 100;

    if (gainPct >= 10) {
      return {
        symbol,
        side: "sell",
        notional: heldQty * price,
        reason: `DCA+ take-profit: ${gainPct.toFixed(1)}% gain from avg cost $${avgCost.toFixed(2)} — locking in profits [${horizon}]`,
        strategyConfidence: 0.95,
        marketData: { currentPrice: price, dipPct: gainPct },
      };
    }
  }

  // ── Main DCA buy logic ─────────────────────────────────────
  const baseDipThreshold = horizon === "fast" ? 1 : horizon === "slow" ? 7 : 3;
  let bestSignal: TradeSignal | null = null;
  let bestDip = -Infinity;

  for (const symbol of DCA_SYMBOLS) {
    const bars = await getDailyBars(symbol, 22);
    if (bars.length < 10) continue;

    const closes = bars.map((b) => b.c);
    const currentPrice = closes[closes.length - 1];
    const heldQty = agentPositions[symbol] ?? 0;

    const avg20 = calculateSMA(closes.slice(0, -1));
    const dip = dipPercent(currentPrice, avg20);

    if (dip > bestDip) {
      bestDip = dip;

      const isDip = dip >= baseDipThreshold;

      // Proportional sizing: deeper dip → bigger buy
      let sizeMultiplier = 1;
      if (dip >= 8) sizeMultiplier = 3;
      else if (dip >= 5) sizeMultiplier = 2;

      // Market fear bonus (cap at 4×)
      if (marketFear) sizeMultiplier = Math.min(4, Math.ceil(sizeMultiplier * 1.5));

      const notional = isDip ? baseAmount * sizeMultiplier : baseAmount;

      // Don't regular-DCA if already holding; wait for a dip
      if (!isDip && heldQty > 0) continue;

      bestSignal = {
        symbol,
        side: "buy",
        notional,
        reason: isDip
          ? `Dip ${dip.toFixed(2)}% below 20-day avg ($${avg20.toFixed(2)}) — buying ${sizeMultiplier}×$${baseAmount}${marketFear ? " + fear bonus" : ""} [${horizon}]`
          : `Scheduled DCA: ${dip.toFixed(2)}% vs avg, no ${baseDipThreshold}% dip yet — base buy [${horizon}]`,
        strategyConfidence: isDip ? 0.80 : 0.65,
        marketData: { currentPrice, dipPct: dip },
      };
    }
  }

  return bestSignal;
}

// ─────────────────────────────────────────────────────────────
// 6. CUSTOM STRATEGY
//    User's plain-English rules + richer market data (20-day high/low,
//    RSI, SMA, volume). Confidence threshold: 0.70 to execute.
// ─────────────────────────────────────────────────────────────
export async function customStrategy(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  // Cap at 500 chars to keep token usage predictable
  const strategyPrompt = (config.strategy_prompt as string | undefined)?.trim().slice(0, 500);
  if (!strategyPrompt || strategyPrompt.length < 10) {
    console.warn("[customStrategy] No strategy_prompt configured — skipping");
    return null;
  }

  type MarketPoint = {
    symbol: string;
    currentPrice: number;
    change1d: number;
    sma20: number;
    rsi14: number;
    momentum5d: number;
    high20: number;
    low20: number;
    volume: number;
    avgVolume: number;
    recentHeadlines: string[];
  };

  const marketData: MarketPoint[] = [];

  for (const symbol of WATCHLIST) {
    try {
      const bars = await getDailyBars(symbol, 25);
      if (bars.length < 20) continue;

      const closes = bars.map((b) => b.c);
      const volumes = bars.map((b) => b.v);
      const highs = bars.map((b) => b.h ?? b.c);
      const lows = bars.map((b) => b.l ?? b.c);

      const currentPrice = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];
      const change1d = ((currentPrice - prevClose) / prevClose) * 100;
      const sma20 = calculateSMA(closes.slice(-20));
      const rsi14 = calculateRSI(closes, 14);
      const momentum5d = momentumPct(closes, 5);
      const high20 = periodHigh(highs, 20);
      const low20 = periodLow(lows, 20);
      const volume = volumes[volumes.length - 1];
      const avgVolume = calculateVolumeMA(volumes.slice(0, -1), 20);

      // Fetch top-2 headlines for context
      const news = await getNews(symbol).catch(() => []);
      const recentHeadlines = news.slice(0, 2).map((n: any) => n.headline ?? "");

      marketData.push({
        symbol, currentPrice, change1d, sma20, rsi14, momentum5d,
        high20, low20, volume, avgVolume, recentHeadlines,
      });
    } catch {
      // skip on fetch error
    }
  }

  if (marketData.length === 0) return null;

  // Build richer market summary for the AI
  const marketSummaryLines = marketData.map((d) => {
    const volRatio = d.avgVolume > 0 ? (d.volume / d.avgVolume).toFixed(1) : "?";
    const newsLine = d.recentHeadlines.length > 0 ? ` | News: ${d.recentHeadlines[0]}` : "";
    return (
      `${d.symbol}: $${d.currentPrice.toFixed(2)}, 1d=${d.change1d.toFixed(2)}%, ` +
      `5d_mom=${d.momentum5d.toFixed(2)}%, RSI14=${d.rsi14.toFixed(1)}, ` +
      `SMA20=$${d.sma20.toFixed(2)}, 20d_high=$${d.high20.toFixed(2)}, 20d_low=$${d.low20.toFixed(2)}, ` +
      `vol_ratio=${volRatio}x${newsLine}`
    );
  });

  const { execute, symbol, side, reasoning, confidence } = await interpretCustomStrategy({
    strategyPrompt: strategyPrompt,
    marketData: marketData.map((d) => ({
      symbol: d.symbol,
      currentPrice: d.currentPrice,
      change1d: d.change1d,
      sma20: d.sma20,
      rsi14: d.rsi14,
      momentum5d: d.momentum5d,
    })),
    currentPositions: agentPositions,
  });

  // Custom strategy requires higher confidence threshold (0.70)
  if (!execute || !symbol || confidence < 0.70) return null;

  const symbolData = marketData.find((d) => d.symbol === symbol);
  if (!symbolData) return null;

  const heldQty = agentPositions[symbol] ?? 0;

  // Safety rails
  if (side === "buy" && heldQty > 0) return null;
  if (side === "sell" && heldQty === 0) return null;

  return {
    symbol,
    side,
    notional: side === "buy" ? 10 : heldQty * symbolData.currentPrice,
    reason: `Custom strategy (confidence ${(confidence * 100).toFixed(0)}%): ${reasoning}`,
    strategyConfidence: confidence,
    marketData: { currentPrice: symbolData.currentPrice, rsi: symbolData.rsi14 },
  };
}

// ─────────────────────────────────────────────────────────────
// 7. NEWS TRADER
//    Trades SOLELY on news headlines — zero technical analysis.
//    One bulk Alpaca news call fetches up to 10 headlines per
//    watchlist symbol.  One Groq call evaluates all of them and
//    returns the single strongest sentiment trade.
//    Hold period: sell when sentiment flips (or config.hold_hours
//    is respected as a label — time-based exit handled by future
//    cron runs re-evaluating sentiment).
// ─────────────────────────────────────────────────────────────
export async function newsTrader(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const sentimentThreshold = Number(config.sentiment_threshold ?? 6) / 10;
  const maxPositions = Number(config.max_positions ?? 3);
  const held = heldSymbols(agentPositions);

  // Fetch news for ALL watchlist symbols in one API call
  const rawNews = await getNewsBulk(WATCHLIST, 50);

  // Group by symbol
  const headlinesBySymbol: Record<string, string[]> = {};
  for (const sym of WATCHLIST) headlinesBySymbol[sym] = [];
  for (const item of rawNews) {
    if (headlinesBySymbol[item.symbol] !== undefined) {
      headlinesBySymbol[item.symbol].push(item.headline);
    }
  }

  if (!Object.values(headlinesBySymbol).some((hl) => hl.length > 0)) return null;

  const decision = await newsTraderDecision({ headlinesBySymbol, heldSymbols: held, sentimentThreshold });

  if (!decision.execute || !decision.symbol) return null;
  if (Math.abs(decision.sentiment_score) < sentimentThreshold) return null;

  const heldQty = agentPositions[decision.symbol] ?? 0;
  if (decision.side === "buy"  && heldQty > 0)          return null; // already in
  if (decision.side === "sell" && heldQty === 0)         return null; // nothing to sell
  if (decision.side === "buy"  && held.length >= maxPositions) return null;

  const bars = await getDailyBars(decision.symbol, 2);
  if (bars.length === 0) return null;
  const currentPrice = bars[bars.length - 1].c;

  // Store headlines in reason so they end up in ai_reasoning
  const headlines = (headlinesBySymbol[decision.symbol] ?? []).slice(0, 5);
  const headlineText = headlines.map((h) => h.slice(0, 80)).join(" | ");
  const reason = `[News Trader] score=${decision.sentiment_score.toFixed(2)} — ${decision.reasoning} | Headlines: ${headlineText}`;

  return {
    symbol:             decision.symbol,
    side:               decision.side,
    notional:           decision.side === "buy" ? 15 : heldQty * currentPrice,
    reason,
    strategyConfidence: decision.confidence,
    skipAiConfirmation: true,
    marketData:         { currentPrice, sentimentScore: decision.sentiment_score },
  };
}

// ─────────────────────────────────────────────────────────────
// 8. BLIND QUANT
//    Trades SOLELY on anonymized numerical data — the AI never
//    sees ticker symbols, company names, or sector info.
//    Anonymizes all 15 watchlist stocks as "Asset_A"–"Asset_O",
//    sends one Groq call, then maps the winner back to a ticker.
// ─────────────────────────────────────────────────────────────
export async function blindQuant(
  config: Record<string, any>,
  agentPositions: Record<string, number>
): Promise<TradeSignal | null> {
  const minConfidence = Number(config.min_confidence ?? 6) / 10;
  const maxPositions = Number(config.max_positions ?? 3);
  const held = heldSymbols(agentPositions);

  const assets: AnonAsset[] = [];
  const assetIdToSymbol: Record<string, string> = {};
  let idx = 0;

  for (const symbol of WATCHLIST) {
    const bars = await getDailyBars(symbol, 30);
    if (bars.length < 22) continue;

    const closes  = bars.map((b) => b.c);
    const volumes = bars.map((b) => b.v);
    const highs   = bars.map((b) => b.h ?? b.c);
    const lows    = bars.map((b) => b.l ?? b.c);

    const cur   = closes[closes.length - 1];
    const p1d   = closes[closes.length - 2] || cur;
    const p5d   = closes[closes.length - 6] || closes[0];
    const p20d  = closes[closes.length - 21] || closes[0];

    const change1d  = p1d  > 0 ? ((cur - p1d)  / p1d)  * 100 : 0;
    const change5d  = p5d  > 0 ? ((cur - p5d)  / p5d)  * 100 : 0;
    const change20d = p20d > 0 ? ((cur - p20d) / p20d) * 100 : 0;

    const avgVol = calculateVolumeMA(volumes.slice(0, -1), 20);
    const volRatio = avgVol > 0 ? volumes[volumes.length - 1] / avgVol : 1;

    const rsi14 = calculateRSI(closes, 14);
    const bb = calculateBollingerBands(closes, 20, 2);
    const bbRange = bb.upper - bb.lower;
    const bbPos = bbRange > 0 ? Math.min(1, Math.max(0, (cur - bb.lower) / bbRange)) : 0.5;

    const high20 = Math.max(...highs.slice(-20));
    const low20  = Math.min(...lows.slice(-20));
    const distHigh = high20 > 0 ? ((cur - high20) / high20) * 100 : 0;
    const distLow  = low20  > 0 ? ((cur - low20)  / low20)  * 100 : 0;

    // Volatility: std-dev of 20-day daily returns
    const ret20 = closes.slice(-21);
    const rets  = ret20.slice(1).map((c, i) => (c - ret20[i]) / ret20[i]);
    const mu    = rets.reduce((a, b) => a + b, 0) / rets.length;
    const vol20 = Math.sqrt(rets.reduce((a, r) => a + (r - mu) ** 2, 0) / rets.length);

    const slope = smaSlope(closes, 20, 5);

    const assetId = `Asset_${String.fromCharCode(65 + idx)}`; // A, B, C…
    assetIdToSymbol[assetId] = symbol;
    idx++;

    assets.push({
      asset_id:                  assetId,
      price_change_1d_pct:       Number(change1d.toFixed(3)),
      price_change_5d_pct:       Number(change5d.toFixed(3)),
      price_change_20d_pct:      Number(change20d.toFixed(3)),
      volume_vs_avg_20d:         Number(volRatio.toFixed(3)),
      rsi_14:                    Number(rsi14.toFixed(1)),
      distance_from_20d_high_pct: Number(distHigh.toFixed(3)),
      distance_from_20d_low_pct:  Number(distLow.toFixed(3)),
      volatility_20d:            Number(vol20.toFixed(4)),
      sma_20_slope:              Number(slope.toFixed(5)),
      bollinger_position:        Number(bbPos.toFixed(3)),
    });
  }

  if (assets.length === 0) return null;

  const heldAssetIds = Object.entries(assetIdToSymbol)
    .filter(([, sym]) => (agentPositions[sym] ?? 0) > 0)
    .map(([id]) => id);

  const decision = await blindQuantDecision({ assets, heldAssetIds, minConfidence });

  if (!decision.execute || !decision.asset_id) return null;
  if (decision.confidence < minConfidence) return null;

  const symbol = assetIdToSymbol[decision.asset_id];
  if (!symbol) return null;

  const heldQty = agentPositions[symbol] ?? 0;
  if (decision.side === "buy"  && heldQty > 0)               return null;
  if (decision.side === "sell" && heldQty === 0)              return null;
  if (decision.side === "buy"  && held.length >= maxPositions) return null;

  const bars = await getDailyBars(symbol, 2);
  if (bars.length === 0) return null;
  const currentPrice = bars[bars.length - 1].c;

  // Store the anonymized packet for the chosen asset in the reason
  const anonAsset = assets.find((a) => a.asset_id === decision.asset_id);
  const reason =
    `[Blind Quant] ${decision.asset_id}→${symbol} | ${decision.reasoning} | ` +
    `data=${JSON.stringify(anonAsset)}`;

  return {
    symbol,
    side:               decision.side,
    notional:           decision.side === "buy" ? 10 : heldQty * currentPrice,
    reason,
    strategyConfidence: decision.confidence,
    skipAiConfirmation: true,
    marketData:         { currentPrice },
  };
}

// ─────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────
export async function runStrategy(
  strategyId: string,
  config: Record<string, any>,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number> = {}
): Promise<TradeSignal | null> {
  switch (strategyId) {
    case "momentum_rider":
      return momentumRider(config, agentPositions);
    case "mean_reversion":
      return meanReversion(config, agentPositions);
    case "prediction_arb":
      return predictionArb(config, agentPositions);
    case "dca_plus":
      return dcaPlus(config, agentPositions, agentAvgCost);
    case "custom":
      return customStrategy(config, agentPositions);
    case "news_trader":
      return newsTrader(config, agentPositions);
    case "blind_quant":
      return blindQuant(config, agentPositions);
    default:
      console.warn(`Unknown strategy: ${strategyId}`);
      return null;
  }
}
