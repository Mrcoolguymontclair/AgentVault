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
  config: Record<string, number | string>;
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
  config: Record<string, number | string>;
  budget: number;
  is_private: boolean;
  model_id: ModelId;
}

export async function fetchUserAgents(userId: string) {
  const { data, error } = await supabase.rpc("rpc_get_user_agents", {
    p_user_id: userId,
  });
  return { data: (data as DbAgent[] | null) ?? [], error: error?.message ?? null };
}

export async function createAgent(userId: string, input: CreateAgentInput) {
  const { data, error } = await supabase.rpc("rpc_create_agent", {
    p_user_id: userId,
    p_name: input.name,
    p_strategy: input.strategy,
    p_description: input.description,
    p_mode: input.mode,
    p_config: input.config,
    p_budget: input.budget,
    p_is_private: input.is_private,
    p_model_id: input.model_id,
  });

  if (error) {
    console.error("[agentService] createAgent failed:", error.message, error.details, error.hint);
  }

  return { data: data as DbAgent | null, error: error?.message ?? null };
}

export async function deleteAgent(agentId: string) {
  const { error } = await supabase.rpc("rpc_delete_agent", {
    p_agent_id: agentId,
  });
  return { error: error?.message ?? null };
}

export async function updateAgentStatus(agentId: string, status: AgentStatus) {
  const { error } = await supabase.rpc("rpc_update_agent_status", {
    p_agent_id: agentId,
    p_status: status,
  });
  return { error: error?.message ?? null };
}

export async function fetchRecentTrades(userId: string, limit = 10) {
  const { data, error } = await supabase.rpc("rpc_get_recent_trades", {
    p_user_id: userId,
    p_limit: limit,
  });
  return { data: (data as DbTrade[] | null) ?? [], error: error?.message ?? null };
}

export interface DbPublicAgent extends DbAgent {
  profiles: { display_name: string; avatar: string } | null;
}

export async function fetchPublicAgent(agentId: string) {
  const { data, error } = await supabase.rpc("rpc_get_public_agent", {
    p_agent_id: agentId,
  });
  return { data: data as DbPublicAgent | null, error: error?.message ?? null };
}

export async function fetchAgentTrades(agentId: string, limit = 50) {
  const { data, error } = await supabase.rpc("rpc_get_agent_trades", {
    p_agent_id: agentId,
    p_limit: limit,
  });
  return { data: (data as DbTrade[] | null) ?? [], error: error?.message ?? null };
}

export async function checkAgentLimit(
  userId: string,
  plan: string
): Promise<{ canCreate: boolean; current: number; limit: number }> {
  const { data } = await supabase.rpc("rpc_check_agent_count", {
    p_user_id: userId,
  });
  const current = (data as number | null) ?? 0;
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
