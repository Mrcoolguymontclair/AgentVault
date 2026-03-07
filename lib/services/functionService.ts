import { supabase } from "@/lib/supabase";

export interface RunAgentResult {
  ok: boolean;
  message?: string;
  skipped?: boolean;
  results?: Array<{
    agentId: string;
    agentName: string;
    success: boolean;
    skipped?: boolean;
    skipReason?: string;
    symbol?: string;
    side?: string;
    qty?: number;
    price?: number;
    pnl?: number;
    aiReasoning?: string;
    error?: string;
  }>;
  error?: string;
}

/** Invoke the run-agents edge function for a specific agent (or all active agents). */
export async function invokeRunAgents(
  agentId?: string,
  force = true
): Promise<RunAgentResult> {
  try {
    const { data, error } = await supabase.functions.invoke("run-agents", {
      body: { agent_id: agentId, force },
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return (data as RunAgentResult) ?? { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Network error invoking run-agents" };
  }
}
