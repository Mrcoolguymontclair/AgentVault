import { supabase } from "@/lib/supabase";
import type { AgentStatus, AgentMode } from "@/store/agentStore";

export interface DbAgent {
  id: string;
  user_id: string;
  name: string;
  strategy: string;
  description: string;
  status: AgentStatus;
  mode: AgentMode;
  pnl: number;
  pnl_pct: number;
  trades_count: number;
  win_rate: number;
  max_drawdown: number;
  sharpe_ratio: number;
  created_at: string;
}

export interface DbTrade {
  id: string;
  agent_id: string;
  user_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  pnl: number;
  executed_at: string;
  agents?: { name: string };
}

export async function fetchUserAgents(userId: string) {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return { data: data as DbAgent[] | null, error: error?.message ?? null };
}

export async function updateAgentStatus(
  agentId: string,
  status: AgentStatus
) {
  const { error } = await supabase
    .from("agents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", agentId);

  return { error: error?.message ?? null };
}

export async function fetchRecentTrades(userId: string, limit = 10) {
  const { data, error } = await supabase
    .from("trades")
    .select("*, agents(name)")
    .eq("user_id", userId)
    .order("executed_at", { ascending: false })
    .limit(limit);

  return { data: data as DbTrade[] | null, error: error?.message ?? null };
}

export function subscribeToTrades(
  userId: string,
  onInsert: (trade: DbTrade) => void
) {
  return supabase
    .channel("trades-channel")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "trades",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onInsert(payload.new as DbTrade)
    )
    .subscribe();
}

export function subscribeToAgents(
  userId: string,
  onChange: (agent: DbAgent) => void
) {
  return supabase
    .channel("agents-channel")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "agents",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onChange(payload.new as DbAgent)
    )
    .subscribe();
}
