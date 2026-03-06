import { supabase } from "@/lib/supabase";

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
