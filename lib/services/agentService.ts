import { supabase } from "@/lib/supabase";
import type { AgentStatus, AgentMode } from "@/store/agentStore";
import type { StrategyId, ModelId } from "@/constants/strategies";
import { TIER_LIMITS } from "@/constants/strategies";

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
  config: Record<string, number>;
  budget: number;
  is_private: boolean;
  model_id: ModelId;
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

export interface CreateAgentInput {
  name: string;
  strategy: StrategyId;
  description: string;
  mode: AgentMode;
  config: Record<string, number>;
  budget: number;
  is_private: boolean;
  model_id: ModelId;
}

export async function fetchUserAgents(userId: string) {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return { data: data as DbAgent[] | null, error: error?.message ?? null };
}

export async function createAgent(userId: string, input: CreateAgentInput) {
  const { data, error } = await supabase
    .from("agents")
    .insert({
      user_id: userId,
      name: input.name,
      strategy: input.strategy,
      description: input.description,
      status: "backtesting" as AgentStatus,
      mode: input.mode,
      config: input.config,
      budget: input.budget,
      is_private: input.is_private,
      model_id: input.model_id,
      pnl: 0,
      pnl_pct: 0,
      trades_count: 0,
      win_rate: 0,
      max_drawdown: 0,
      sharpe_ratio: 0,
    })
    .select()
    .single();

  return { data: data as DbAgent | null, error: error?.message ?? null };
}

export async function deleteAgent(agentId: string) {
  const { error } = await supabase
    .from("agents")
    .delete()
    .eq("id", agentId);

  return { error: error?.message ?? null };
}

export async function updateAgentStatus(agentId: string, status: AgentStatus) {
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

export async function fetchAgentTrades(agentId: string, limit = 50) {
  const { data, error } = await supabase
    .from("trades")
    .select("*, agents(name)")
    .eq("agent_id", agentId)
    .order("executed_at", { ascending: false })
    .limit(limit);

  return { data: data as DbTrade[] | null, error: error?.message ?? null };
}

export async function checkAgentLimit(
  userId: string,
  plan: string
): Promise<{ canCreate: boolean; current: number; limit: number }> {
  const { data } = await supabase
    .from("agents")
    .select("id", { count: "exact" })
    .eq("user_id", userId)
    .neq("status", "stopped");

  const current = data?.length ?? 0;
  const limit = TIER_LIMITS[plan as keyof typeof TIER_LIMITS] ?? TIER_LIMITS.free;
  return { canCreate: current < limit, current, limit };
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
