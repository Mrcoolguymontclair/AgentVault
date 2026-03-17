/** Returns true if the US stock market is currently open (9:30 AM–4:00 PM ET, Mon–Fri) */
export function isMarketOpen(): boolean {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const day = et.getDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/** Simple Moving Average of closing prices */
export function calculateSMA(closes: number[]): number {
  if (closes.length === 0) return 0;
  return closes.reduce((a, b) => a + b, 0) / closes.length;
}

/**
 * Wilder's RSI(period).  Requires at least period+1 data points.
 * Returns 50 (neutral) if insufficient data.
 */
export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, delta)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -delta)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** % drop from average: positive = dip, negative = premium */
export function dipPercent(currentPrice: number, avgPrice: number): number {
  if (avgPrice === 0) return 0;
  return ((avgPrice - currentPrice) / avgPrice) * 100;
}

/** N-day price momentum as a % */
export function momentumPct(closes: number[], days: number): number {
  if (closes.length < days + 1) return 0;
  const recent = closes[closes.length - 1];
  const past = closes[closes.length - 1 - days];
  if (past === 0) return 0;
  return ((recent - past) / past) * 100;
}

/** Bollinger Bands (upper, middle, lower) over `period` bars */
export function calculateBollingerBands(
  closes: number[],
  period = 20,
  multiplier = 2
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) {
    const p = closes[closes.length - 1] ?? 0;
    return { upper: p, middle: p, lower: p };
  }
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + Math.pow(v - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + multiplier * std, middle, lower: middle - multiplier * std };
}

/** Average volume over `period` bars */
export function calculateVolumeMA(volumes: number[], period: number): number {
  if (volumes.length === 0) return 0;
  const slice = volumes.slice(-Math.min(period, volumes.length));
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** SMA slope: positive = SMA is trending up over the last `lookback` bars */
export function smaSlope(closes: number[], period: number, lookback = 5): number {
  if (closes.length < period + lookback) return 0;
  const recentSMA = calculateSMA(closes.slice(-period));
  const pastSMA = calculateSMA(closes.slice(-(period + lookback), -lookback));
  return recentSMA - pastSMA;
}

/** Minimum value over the last `period` entries */
export function periodLow(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-Math.min(period, values.length));
  return Math.min(...slice);
}

/** Maximum value over the last `period` entries */
export function periodHigh(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-Math.min(period, values.length));
  return Math.max(...slice);
}
