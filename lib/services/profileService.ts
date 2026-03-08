import { supabase } from "@/lib/supabase";

export interface DbProfile {
  id: string;
  display_name: string;
  avatar: string;
  trading_level: "beginner" | "intermediate" | "advanced" | "professional";
  plan: "free" | "pro" | "elite";
  balance: number;
  total_return_pct: number;
  win_rate: number;
  rank: number | null;
  active_agents: number;
  created_at: string;
}

export async function fetchProfile(userId: string) {
  const { data, error } = await supabase.rpc("rpc_get_profile", {
    p_user_id: userId,
  });
  return { data: data as DbProfile | null, error: error?.message ?? null };
}

export async function upsertProfile(userId: string, updates: Partial<DbProfile>) {
  const { data, error } = await supabase.rpc("rpc_upsert_profile", {
    p_user_id: userId,
    p_display_name: updates.display_name ?? null,
    p_avatar: updates.avatar ?? null,
    p_trading_level: updates.trading_level ?? null,
    p_plan: updates.plan ?? null,
  });
  return { data: data as DbProfile | null, error: error?.message ?? null };
}

export async function updateActiveAgentCount(userId: string) {
  await supabase.rpc("rpc_update_active_agent_count", { p_user_id: userId });
}
