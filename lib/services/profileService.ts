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
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  return { data: data as DbProfile | null, error: error?.message ?? null };
}

export async function upsertProfile(userId: string, updates: Partial<DbProfile>) {
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...updates }, { onConflict: "id" })
    .select()
    .single();

  return { data: data as DbProfile | null, error: error?.message ?? null };
}

export async function updateActiveAgentCount(userId: string) {
  const { count } = await supabase
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");

  await supabase
    .from("profiles")
    .update({ active_agents: count ?? 0 })
    .eq("id", userId);
}
