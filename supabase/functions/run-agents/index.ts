import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isMarketOpen } from "./market-utils.ts";
import { confirmTrade } from "./groq.ts";
import { placeOrder, getPositions } from "./alpaca.ts";
import { runStrategy } from "./strategies.ts";
import type { DbAgent, ExecutionResult } from "./types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      agent_id?: string;
      force?: boolean;
    };

    // Market hours gate (bypass with force=true for testing)
    if (!body.force && !isMarketOpen()) {
      return json({ ok: true, marketClosed: true, message: "Market is closed — no agents run", results: [] });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Fetch agents. When force=true with a specific agent_id, bypass the
    // status=active filter so "Run Now" works on any agent (backtesting, paused, etc.)
    let query = supabase.from("agents").select("*");
    if (body.agent_id) {
      query = (query as any).eq("id", body.agent_id);
      if (!body.force) query = (query as any).eq("status", "active");
    } else {
      query = (query as any).eq("status", "active");
    }
    const { data: agents, error: agentsErr } = await query;

    if (agentsErr) throw new Error(`DB error fetching agents: ${agentsErr.message}`);
    if (!agents || agents.length === 0) {
      return json({ ok: true, message: "No active agents to run", count: 0, results: [] });
    }

    // Get Alpaca positions once (shared paper account)
    const alpacaPositions = await getPositions();

    // Run agents sequentially to avoid overwhelming APIs
    const results: ExecutionResult[] = [];
    for (const agent of agents as DbAgent[]) {
      const result = await runAgent(supabase, agent, alpacaPositions);
      results.push(result);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success && !r.skipped).length;

    return json({ ok: true, processed: results.length, succeeded, failed, results });
  } catch (err) {
    console.error("run-agents fatal error:", err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

// ─────────────────────────────────────────────────────────────
// Core execution for a single agent
// ─────────────────────────────────────────────────────────────
async function runAgent(
  supabase: ReturnType<typeof createClient>,
  agent: DbAgent,
  alpacaPositions: Record<string, { qty: number; avg_entry_price: number }>
): Promise<ExecutionResult> {
  const base: ExecutionResult = { agentId: agent.id, agentName: agent.name, success: false };

  try {
    const config = agent.config ?? {};
    const budget = Number(agent.budget ?? 1000);

    // ── Daily loss limit check (5% of budget) ───────────────
    const today = new Date().toISOString().split("T")[0];
    const { data: todayTrades } = await supabase
      .from("trades")
      .select("pnl")
      .eq("agent_id", agent.id)
      .gte("executed_at", `${today}T00:00:00Z`);

    const dailyPnl = (todayTrades ?? []).reduce((s, t) => s + Number(t.pnl), 0);
    const dailyLossLimit = budget * 0.05;
    if (dailyPnl <= -dailyLossLimit) {
      return { ...base, skipped: true, skipReason: `Daily loss limit hit ($${Math.abs(dailyPnl).toFixed(2)})` };
    }

    // ── Calculate agent's virtual positions from DB ──────────
    const { data: allTrades } = await supabase
      .from("trades")
      .select("symbol, side, quantity, price")
      .eq("agent_id", agent.id);

    const agentPositions: Record<string, number> = {}; // symbol → net qty held
    const agentAvgCost: Record<string, number> = {}; // symbol → avg buy price

    for (const t of allTrades ?? []) {
      const tradeQty = Number(t.quantity);
      const sym = t.symbol;
      if (t.side === "buy") {
        const prevQty = agentPositions[sym] ?? 0;
        const prevAvg = agentAvgCost[sym] ?? 0;
        agentPositions[sym] = prevQty + tradeQty;
        agentAvgCost[sym] = prevQty > 0
          ? (prevAvg * prevQty + Number(t.price) * tradeQty) / (prevQty + tradeQty)
          : Number(t.price);
      } else {
        agentPositions[sym] = Math.max(0, (agentPositions[sym] ?? 0) - tradeQty);
      }
    }

    // ── Available budget ─────────────────────────────────────
    const invested = Object.entries(agentPositions).reduce((sum, [sym, qty]) => {
      const price = alpacaPositions[sym]?.avg_entry_price ?? agentAvgCost[sym] ?? 0;
      return sum + qty * price;
    }, 0);
    const availableBudget = Math.max(0, budget - invested);

    if (availableBudget < 1) {
      return { ...base, skipped: true, skipReason: "Budget fully deployed" };
    }

    // ── Run strategy ─────────────────────────────────────────
    const signal = await runStrategy(agent.strategy, config, agentPositions);
    if (!signal) {
      return { ...base, skipped: true, skipReason: "No signal generated" };
    }

    // ── Resolve notional → dollar amount ─────────────────────
    // For buys: notional is a % of budget.  For sells: notional is total $.
    let dollarAmount: number;
    if (signal.side === "buy") {
      // notional stored as a percentage value (e.g. 10 = 10%)
      dollarAmount = Math.min(budget * (signal.notional / 100), availableBudget);
    } else {
      dollarAmount = signal.notional; // already in dollars
    }

    if (dollarAmount < 1) {
      return { ...base, skipped: true, skipReason: "Trade size too small" };
    }

    // ── AI confirmation ───────────────────────────────────────
    const ai = await confirmTrade({
      strategy: agent.strategy,
      symbol: signal.symbol,
      side: signal.side,
      reason: signal.reason,
      ...signal.marketData,
    });

    if (!ai.execute || ai.confidence < 0.6) {
      return {
        ...base,
        skipped: true,
        skipReason: `AI rejected (confidence ${(ai.confidence * 100).toFixed(0)}%): ${ai.reasoning}`,
      };
    }

    // ── Calculate quantity ────────────────────────────────────
    const currentPrice = signal.marketData.currentPrice;
    const rawQty = dollarAmount / currentPrice;
    const qty = signal.side === "sell"
      ? Math.floor(agentPositions[signal.symbol] ?? 0)
      : Math.floor(rawQty);

    if (qty <= 0) {
      return { ...base, skipped: true, skipReason: "Qty rounds to 0" };
    }

    // ── Place Alpaca paper order ──────────────────────────────
    let fillPrice = currentPrice;
    try {
      const order = await placeOrder(signal.symbol, qty, signal.side);
      // filled_avg_price may be null until filled; fall back to current price
      fillPrice = Number(order.filled_avg_price ?? currentPrice);
    } catch (err) {
      console.error("Alpaca order error:", err);
      // Continue to log a simulated trade even if Alpaca rejects
      // (Alpaca paper API sometimes rejects outside-hours orders)
    }

    // ── P&L for this trade ────────────────────────────────────
    let tradePnl = 0;
    if (signal.side === "sell") {
      const avgCost = agentAvgCost[signal.symbol] ?? fillPrice;
      tradePnl = (fillPrice - avgCost) * qty;
    }

    // ── Log trade to DB ───────────────────────────────────────
    await supabase.from("trades").insert({
      agent_id: agent.id,
      user_id: agent.user_id,
      symbol: signal.symbol,
      side: signal.side,
      quantity: qty,
      price: fillPrice,
      pnl: tradePnl,
      executed_at: new Date().toISOString(),
    });

    // ── Update agent stats ────────────────────────────────────
    const newPnl = Number(agent.pnl) + tradePnl;
    const newPnlPct = budget > 0 ? (newPnl / budget) * 100 : 0;
    const newTrades = agent.trades_count + 1;

    // Win rate: count profitable sell trades
    const { data: sellTrades } = await supabase
      .from("trades")
      .select("pnl")
      .eq("agent_id", agent.id)
      .eq("side", "sell");

    const sells = sellTrades ?? [];
    const winners = sells.filter((t) => Number(t.pnl) > 0).length;
    const newWinRate = sells.length > 0 ? (winners / sells.length) * 100 : 0;

    await supabase.from("agents").update({
      pnl: newPnl,
      pnl_pct: newPnlPct,
      trades_count: newTrades,
      win_rate: newWinRate,
      updated_at: new Date().toISOString(),
    }).eq("id", agent.id);

    // ── Portfolio snapshot (upsert today's value) ─────────────
    const portfolioValue = budget + newPnl;
    await supabase.from("portfolio_snapshots").upsert(
      {
        user_id: agent.user_id,
        agent_id: agent.id,
        value: portfolioValue,
        pnl_pct: newPnlPct,
        snapshot_date: today,
      },
      { onConflict: "user_id,agent_id,snapshot_date" }
    );

    return {
      ...base,
      success: true,
      symbol: signal.symbol,
      side: signal.side,
      qty,
      price: fillPrice,
      pnl: tradePnl,
      aiReasoning: ai.reasoning,
    };
  } catch (err) {
    console.error(`Agent ${agent.id} error:`, err);
    return { ...base, error: String(err) };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
