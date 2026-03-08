import { supabase } from "@/lib/supabase";

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
