import { supabase } from "@/lib/supabase";

export interface AgentLog {
  id: string;
  agent_id: string;
  agent_name: string;
  strategy: string;
  timestamp: string;
  signal_detected: boolean;
  signal_symbol?: string;
  signal_side?: string;
  ai_reasoning?: string;
  ai_confidence?: number;
  action: "traded" | "skipped" | "error";
  skip_reason?: string;
  trade_symbol?: string;
  trade_qty?: number;
  trade_price?: number;
  trade_pnl?: number;
}

export async function fetchAgentLogs(
  userId: string,
  agentId?: string,
  limit = 50
): Promise<AgentLog[]> {
  const { data } = await supabase.rpc("rpc_get_agent_logs", {
    p_user_id: userId,
    p_agent_id: agentId ?? null,
    p_limit: limit,
  });
  return (data as AgentLog[]) ?? [];
}

export async function clearAgentLogs(userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("rpc_clear_agent_logs", { p_user_id: userId });
  return { error: error?.message ?? null };
}

export async function resetAgentStats(
  agentId: string,
  userId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("rpc_reset_agent_stats", {
    p_agent_id: agentId,
    p_user_id: userId,
  });
  return { error: error?.message ?? null };
}

export async function simulateTrade(opts: {
  agentId: string;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
}): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("rpc_simulate_trade", {
    p_agent_id: opts.agentId,
    p_user_id: opts.userId,
    p_symbol: opts.symbol,
    p_side: opts.side,
    p_qty: opts.qty,
    p_price: opts.price,
  });
  return { error: error?.message ?? null };
}

export async function fetchDebugTable(
  userId: string,
  table: string,
  limit = 20
): Promise<unknown[]> {
  const { data } = await supabase.rpc("rpc_debug_table", {
    p_user_id: userId,
    p_table: table,
    p_limit: limit,
  });
  if (!data) return [];
  try {
    return typeof data === "string" ? JSON.parse(data) : (data as unknown[]);
  } catch {
    return [];
  }
}

export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from("agents").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Alpaca paper trading uses shared server-side keys stored in Supabase secrets. */
export async function fetchAlpacaStatus(_userId?: string): Promise<{
  configured: boolean;
  keyPrefix?: string;
}> {
  // Paper trading keys are stored in Edge Function secrets (ALPACA_API_KEY / ALPACA_API_SECRET).
  // There are no per-user client-side keys — always report as configured.
  return { configured: true };
}

// ── Groq usage ────────────────────────────────────────────────

export interface GroqStats {
  tokens_used:      number;
  request_count:    number;
  primary_requests: number;
  backup_requests:  number;
}

export interface GroqHourlyEntry {
  hour_start:    string; // "HH:MM" in ET
  tokens_used:   number;
  request_count: number;
}

/** Returns the timestamp of the last execution where a signal was detected for an agent. */
export async function fetchLastSignal(agentId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("agent_logs")
      .select("timestamp")
      .eq("agent_id", agentId)
      .eq("signal_detected", true)
      .order("timestamp", { ascending: false })
      .limit(1)
      .single();
    return (data as any)?.timestamp ?? null;
  } catch {
    return null;
  }
}

export async function fetchGroqStatsToday(): Promise<GroqStats | null> {
  try {
    const { data, error } = await supabase.rpc("rpc_get_groq_stats_today");
    if (error || !data) return null;
    const d = typeof data === "string" ? JSON.parse(data) : data;
    return {
      tokens_used:      Number(d.tokens_used      ?? 0),
      request_count:    Number(d.request_count     ?? 0),
      primary_requests: Number(d.primary_requests  ?? 0),
      backup_requests:  Number(d.backup_requests   ?? 0),
    };
  } catch {
    return null;
  }
}

export async function fetchGroqUsageHistory(): Promise<GroqHourlyEntry[]> {
  try {
    const { data, error } = await supabase.rpc("rpc_get_groq_usage_history");
    if (error || !Array.isArray(data)) return [];
    return (data as any[]).map((row) => ({
      hour_start:    String(row.hour_start ?? ""),
      tokens_used:   Number(row.tokens_used   ?? 0),
      request_count: Number(row.request_count ?? 0),
    }));
  } catch {
    return [];
  }
}
