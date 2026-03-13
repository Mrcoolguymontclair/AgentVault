import { supabase } from "@/lib/supabase";

export interface RunAgentResult {
  ok: boolean;
  message?: string;
  marketClosed?: boolean;
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
      // Some SDK versions surface the parsed body inside error.context
      const ctx = (error as any)?.context;
      if (ctx && typeof ctx === "object" && "ok" in ctx) {
        return ctx as RunAgentResult;
      }
      return { ok: false, error: error.message ?? String(error) };
    }

    if (!data) {
      return { ok: false, error: "No response received from agent runner." };
    }

    // In some React Native environments the SDK returns a raw Response object
    // instead of parsed JSON — detect by checking for the .json() method.
    if (typeof (data as any).json === "function") {
      try {
        const parsed = await (data as any).json();
        return (parsed as RunAgentResult) ?? { ok: false, error: "Empty response body." };
      } catch {
        return { ok: false, error: "Could not parse response from agent runner." };
      }
    }

    const result = data as RunAgentResult;

    // If the shape is missing the 'ok' field the function returned something unexpected
    if (typeof result.ok !== "boolean") {
      return { ok: false, error: `Unexpected response shape: ${JSON.stringify(result).slice(0, 120)}` };
    }

    return result;
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Network error invoking run-agents." };
  }
}
