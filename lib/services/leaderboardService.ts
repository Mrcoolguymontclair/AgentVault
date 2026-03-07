import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────

export interface AgentLeaderboardEntry {
  id: string;
  name: string;
  strategy: string;
  config: Record<string, number>;
  pnl: number;
  pnl_pct: number;
  win_rate: number;
  trades_count: number;
  budget: number;
  mode: "paper" | "live";
  status: string;
  user_id: string;
  display_name: string;
  avatar: string;
  followers_count: number;
  rank: number;
  /** Filled in client-side after period-return fetch */
  period_pnl?: number;
}

/** Legacy — kept for backward compatibility with existing user-rank query */
export interface LeaderboardEntry {
  id: string;
  display_name: string;
  avatar: string;
  plan: "free" | "pro" | "elite";
  win_rate: number;
  total_pnl: number;
  total_return_pct: number;
  agent_count: number;
  trade_count: number;
  rank: number;
}

// ─── Leaderboard queries ──────────────────────────────────────

export async function fetchAgentLeaderboard(limit = 100) {
  const { data, error } = await supabase
    .from("agent_leaderboard")
    .select("*")
    .order("rank", { ascending: true })
    .limit(limit);

  return {
    data: (data as AgentLeaderboardEntry[] | null) ?? [],
    error: error?.message ?? null,
  };
}

/** Returns sum of realized pnl per agent for trades since `since`. */
export async function fetchPeriodReturns(
  since: Date
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("trades")
    .select("agent_id, pnl")
    .gte("executed_at", since.toISOString());

  const totals: Record<string, number> = {};
  for (const t of data ?? []) {
    totals[t.agent_id] = (totals[t.agent_id] ?? 0) + Number(t.pnl);
  }
  return totals;
}

/** Agents with the most positive trade pnl in the last 24 hours. */
export async function fetchTrendingAgents(limit = 6): Promise<AgentLeaderboardEntry[]> {
  const since = new Date();
  since.setHours(since.getHours() - 24);

  // Pull recent positive trades with their agents
  const { data: tradeData } = await supabase
    .from("trades")
    .select("agent_id, pnl")
    .gte("executed_at", since.toISOString())
    .gt("pnl", 0);

  if (!tradeData || tradeData.length === 0) return [];

  // Sum pnl per agent, pick top N
  const pnlMap: Record<string, number> = {};
  for (const t of tradeData) {
    pnlMap[t.agent_id] = (pnlMap[t.agent_id] ?? 0) + Number(t.pnl);
  }
  const topIds = Object.entries(pnlMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);

  if (topIds.length === 0) return [];

  const { data } = await supabase
    .from("agent_leaderboard")
    .select("*")
    .in("id", topIds);

  // Attach 24h pnl and sort by it
  return ((data as AgentLeaderboardEntry[]) ?? [])
    .map((e) => ({ ...e, period_pnl: pnlMap[e.id] ?? 0 }))
    .sort((a, b) => (b.period_pnl ?? 0) - (a.period_pnl ?? 0));
}

// ─── Follow / unfollow ────────────────────────────────────────

export async function fetchFollowedAgentIds(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("agent_follows")
    .select("agent_id")
    .eq("follower_id", userId);

  return new Set((data ?? []).map((r: { agent_id: string }) => r.agent_id));
}

export async function followAgent(
  followerId: string,
  agentId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("agent_follows")
    .insert({ follower_id: followerId, agent_id: agentId });
  return { error: error?.message ?? null };
}

export async function unfollowAgent(
  followerId: string,
  agentId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("agent_follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("agent_id", agentId);
  return { error: error?.message ?? null };
}

// ─── Legacy user-rank (kept for settings/other screens) ──────

export async function fetchLeaderboard(limit = 50) {
  const { data, error } = await supabase
    .from("leaderboard_view")
    .select("*")
    .order("rank", { ascending: true })
    .limit(limit);
  return { data: data as LeaderboardEntry[] | null, error: error?.message ?? null };
}

export async function fetchUserRank(userId: string) {
  const { data, error } = await supabase
    .from("leaderboard_view")
    .select("rank, total_return_pct, win_rate, agent_count, trade_count")
    .eq("id", userId)
    .single();
  return { data, error: error?.message ?? null };
}
