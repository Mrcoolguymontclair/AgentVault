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
  const { data, error } = await supabase.rpc("rpc_get_agent_leaderboard", {
    p_limit: limit,
  });
  return {
    data: (data as AgentLeaderboardEntry[] | null) ?? [],
    error: error?.message ?? null,
  };
}

/** Returns sum of realized pnl per agent for trades since `since`. */
export async function fetchPeriodReturns(
  since: Date
): Promise<Record<string, number>> {
  const { data } = await supabase.rpc("rpc_get_period_returns", {
    p_since: since.toISOString(),
  });

  const totals: Record<string, number> = {};
  for (const t of (data as { agent_id: string; total_pnl: number }[] | null) ?? []) {
    totals[t.agent_id] = Number(t.total_pnl);
  }
  return totals;
}

/** Agents with the most positive trade pnl in the last 24 hours. */
export async function fetchTrendingAgents(limit = 6): Promise<AgentLeaderboardEntry[]> {
  const since = new Date();
  since.setHours(since.getHours() - 24);

  const { data } = await supabase.rpc("rpc_get_trending_agents", {
    p_since: since.toISOString(),
    p_limit: limit,
  });

  return (data as AgentLeaderboardEntry[] | null) ?? [];
}

// ─── Follow / unfollow ────────────────────────────────────────

export async function fetchFollowedAgentIds(userId: string): Promise<Set<string>> {
  const { data } = await supabase.rpc("rpc_get_followed_agent_ids", {
    p_user_id: userId,
  });
  return new Set((data as string[] | null) ?? []);
}

export async function followAgent(
  followerId: string,
  agentId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("rpc_follow_agent", {
    p_follower_id: followerId,
    p_agent_id: agentId,
  });
  return { error: error?.message ?? null };
}

export async function unfollowAgent(
  followerId: string,
  agentId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("rpc_unfollow_agent", {
    p_follower_id: followerId,
    p_agent_id: agentId,
  });
  return { error: error?.message ?? null };
}

// ─── Legacy user-rank (kept for settings/other screens) ──────

export async function fetchLeaderboard(limit = 50) {
  const { data, error } = await supabase.rpc("rpc_get_leaderboard", {
    p_limit: limit,
  });
  return { data: data as LeaderboardEntry[] | null, error: error?.message ?? null };
}

export async function fetchUserRank(userId: string) {
  const { data, error } = await supabase.rpc("rpc_get_user_rank", {
    p_user_id: userId,
  });
  return { data, error: error?.message ?? null };
}
