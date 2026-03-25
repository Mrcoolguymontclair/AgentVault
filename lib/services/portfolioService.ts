import { supabase } from "@/lib/supabase";

// Agent sparkline / chart constants
const AGENT_CHART_COLORS = [
  "#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316",
];

export interface ChartPoint {
  date: string; // ISO date "YYYY-MM-DD"
  value: number;
}

export type Timeframe = "1W" | "1M" | "3M" | "ALL";

export const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  ALL: 365,
};

export async function fetchPortfolioSnapshots(
  userId: string,
  timeframe: Timeframe
): Promise<ChartPoint[]> {
  const days = TIMEFRAME_DAYS[timeframe];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().split("T")[0];

  const { data } = await supabase.rpc("rpc_get_portfolio_snapshots", {
    p_user_id: userId,
    p_since: sinceDate,
  });

  return ((data as { snapshot_date: string; value: number }[] | null) ?? []).map((d) => ({
    date: d.snapshot_date,
    value: Number(d.value),
  }));
}

/**
 * Generates a smooth, deterministic portfolio curve for new users
 * who have no real portfolio_snapshots yet.
 * The curve starts at `baseValue` and trends toward `baseValue + totalPnL`.
 */
export function generateSyntheticPortfolioData(
  totalPnL: number,
  days: number,
  baseValue = 10000
): ChartPoint[] {
  const now = new Date();

  // New users with no PnL get a flat line — no fake oscillation
  if (totalPnL === 0) {
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    return [
      { date: start.toISOString().split("T")[0], value: baseValue },
      { date: now.toISOString().split("T")[0], value: baseValue },
    ];
  }

  const points: ChartPoint[] = [];
  const endValue = baseValue + totalPnL;

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    // Skip weekends for realism
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const progress = days > 0 ? (days - i) / days : 1;

    // Ease-in-out cubic progression
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const trend = baseValue + (endValue - baseValue) * eased;

    // Deterministic noise using sin/cos with index as seed
    const idx = days - i;
    const noise =
      (Math.sin(idx * 2.3) * 0.4 + Math.cos(idx * 1.7) * 0.3) *
      Math.max(Math.abs(totalPnL) * 0.08, 50);

    points.push({
      date: dateStr,
      value: Math.round((trend + noise) * 100) / 100,
    });
  }

  // Ensure last point is exactly the current value
  if (points.length > 0) {
    points[points.length - 1].value = endValue;
  } else {
    points.push({ date: now.toISOString().split("T")[0], value: endValue });
  }

  return points;
}

/**
 * Fetch current / last-known prices for a list of symbols.
 * Calls the get-current-prices edge function (Alpaca latest trade → last bar close fallback).
 * Works on weekends — returns Friday close price.
 */
export async function fetchCurrentPrices(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  try {
    const { data, error } = await supabase.functions.invoke("get-current-prices", {
      body: { symbols },
    });
    if (error || !data?.prices) return {};
    return data.prices as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * Build a portfolio value chart from trade history when no daily snapshots exist.
 * Starts at `baseValue` (total agent budget) and plots cumulative realized PnL at each trade date,
 * with `currentValue` as the final point (includes unrealized P&L).
 */
export async function buildChartFromTrades(
  userId: string,
  currentValue: number,
  days: number,
  baseValue?: number
): Promise<ChartPoint[]> {
  const base = baseValue ?? currentValue;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  const { data } = await supabase
    .from("trades")
    .select("executed_at, pnl")
    .eq("user_id", userId)
    .order("executed_at", { ascending: true });

  const rows = (data as { executed_at: string; pnl: number }[] | null) ?? [];

  if (rows.length === 0) {
    return [
      { date: sinceDate, value: base },
      { date: today, value: currentValue },
    ];
  }

  // Build cumulative PnL keyed by trade date
  let cumPnl = 0;
  const dateToValue: Record<string, number> = {};
  for (const row of rows) {
    cumPnl += Number(row.pnl ?? 0);
    const date = (row.executed_at as string).split("T")[0];
    dateToValue[date] = base + cumPnl;
  }

  const allDates = Object.keys(dateToValue).sort();
  const prevDates = allDates.filter((d) => d < sinceDate);
  const startValue =
    prevDates.length > 0 ? dateToValue[prevDates[prevDates.length - 1]] : base;
  const windowDates = allDates.filter((d) => d >= sinceDate);

  const points: ChartPoint[] = [{ date: sinceDate, value: startValue }];
  for (const date of windowDates) {
    points.push({ date, value: dateToValue[date] });
  }

  // Final point = live portfolio value (includes unrealized P&L)
  if (points[points.length - 1].date === today) {
    points[points.length - 1].value = currentValue;
  } else {
    points.push({ date: today, value: currentValue });
  }

  return points;
}

/** Fetch SPY daily bars from the get-market-bars edge function. */
export async function fetchSpyBars(days: number): Promise<{ date: string; close: number }[]> {
  try {
    const { data, error } = await supabase.functions.invoke("get-market-bars", {
      body: { symbol: "SPY", days },
    });
    if (error || !data?.bars) return [];
    return data.bars as { date: string; close: number }[];
  } catch {
    return [];
  }
}

/**
 * Normalize SPY bars to % change from first point, filtered to the
 * date range of portfolioData, so both lines start at 0%.
 */
export function buildSpyOverlay(
  spyBars: { date: string; close: number }[],
  portfolioData: ChartPoint[]
): ChartPoint[] {
  if (spyBars.length < 2 || portfolioData.length < 2) return [];
  const startDate = portfolioData[0].date;
  const endDate = portfolioData[portfolioData.length - 1].date;
  const filtered = spyBars.filter((b) => b.date >= startDate && b.date <= endDate);
  if (filtered.length < 2) return [];
  const base = filtered[0].close;
  return filtered.map((b) => ({
    date: b.date,
    value: ((b.close - base) / base) * 100,
  }));
}

/** Batch-fetch pnl_pct history for sparklines on agent cards. */
export async function fetchAgentPnlHistories(
  agentIds: string[],
  days = 30
): Promise<Record<string, number[]>> {
  if (agentIds.length === 0) return {};
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().split("T")[0];

  const { data } = await supabase
    .from("portfolio_snapshots")
    .select("agent_id, pnl_pct, snapshot_date")
    .in("agent_id", agentIds)
    .gte("snapshot_date", sinceDate)
    .order("snapshot_date", { ascending: true });

  const result: Record<string, number[]> = {};
  for (const row of (data as { agent_id: string; pnl_pct: number }[] | null) ?? []) {
    if (!result[row.agent_id]) result[row.agent_id] = [];
    result[row.agent_id].push(Number(row.pnl_pct));
  }
  return result;
}

/** Fetch per-agent ChartPoints for the multi-agent chart view. */
export async function fetchAllAgentSnapshots(
  agentIds: string[],
  timeframe: Timeframe
): Promise<Record<string, ChartPoint[]>> {
  if (agentIds.length === 0) return {};
  const days = TIMEFRAME_DAYS[timeframe];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceDate = since.toISOString().split("T")[0];

  const { data } = await supabase
    .from("portfolio_snapshots")
    .select("agent_id, snapshot_date, value")
    .in("agent_id", agentIds)
    .gte("snapshot_date", sinceDate)
    .order("snapshot_date", { ascending: true });

  const result: Record<string, ChartPoint[]> = {};
  for (const row of (data as { agent_id: string; snapshot_date: string; value: number }[] | null) ?? []) {
    if (!result[row.agent_id]) result[row.agent_id] = [];
    result[row.agent_id].push({ date: row.snapshot_date, value: Number(row.value) });
  }
  return result;
}

export { AGENT_CHART_COLORS };

export function getMarketStatus(): {
  status: "open" | "premarket" | "afterhours" | "closed";
  label: string;
  colorKey: "success" | "warning" | "danger";
} {
  const now = new Date();
  // Convert to ET using locale string trick
  const etString = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });

  // Parse "HH:MM" from locale string
  const match = etString.match(/(\d+):(\d+)/);
  const etHours = match ? parseInt(match[1], 10) : 0;
  const etMinutes = match ? parseInt(match[2], 10) : 0;
  const totalMins = etHours * 60 + etMinutes;

  const etDate = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const day = etDate.getDay();

  if (day === 0 || day === 6) {
    return { status: "closed", label: "Market Closed", colorKey: "danger" };
  }

  const PRE_OPEN = 4 * 60; // 4:00 AM ET
  const OPEN = 9 * 60 + 30; // 9:30 AM ET
  const CLOSE = 16 * 60; // 4:00 PM ET
  const AH_CLOSE = 20 * 60; // 8:00 PM ET

  if (totalMins < PRE_OPEN || totalMins >= AH_CLOSE) {
    return { status: "closed", label: "Closed", colorKey: "danger" };
  } else if (totalMins < OPEN) {
    return { status: "premarket", label: "Pre-Market", colorKey: "warning" };
  } else if (totalMins < CLOSE) {
    return { status: "open", label: "Market Open", colorKey: "success" };
  } else {
    return { status: "afterhours", label: "After Hours", colorKey: "warning" };
  }
}
