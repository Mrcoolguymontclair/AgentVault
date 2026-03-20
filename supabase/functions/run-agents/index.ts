import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isMarketOpen } from "./market-utils.ts";
import { confirmTrade } from "./groq.ts";
import { placeOrder, getPositions } from "./alpaca.ts";
import { runStrategy, clearMarketCache, getLastStrategyDiagnostics } from "./strategies.ts";
import { initTracker, setCurrentAgent } from "./groq-tracker.ts";
import type { DbAgent, ExecutionResult, AgentLogInsert } from "./types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  const rawBody = await req.text().catch(() => "");
  console.log(`[run-agents] invoked method=${req.method} hasAuth=${!!req.headers.get("authorization")} body=${rawBody}`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = (rawBody ? JSON.parse(rawBody) : {}) as {
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

    // ── Init Groq usage tracker ───────────────────────────────
    // Load today's token count so the tracker knows the daily budget remaining
    const { data: dailyTokenData } = await supabase.rpc("rpc_get_groq_usage_today");
    initTracker(supabase, Number(dailyTokenData ?? 0));

    // ── Clear market-data cache for this run ──────────────────
    clearMarketCache();

    // ── Prioritise agents (least-recently-traded first) ───────
    // Agents that just traded are less likely to have a new signal;
    // check them last so earlier agents get the full token budget.
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: recentTradeRows } = await supabase
      .from("trades")
      .select("agent_id")
      .in("agent_id", (agents as DbAgent[]).map((a) => a.id))
      .gte("executed_at", fifteenMinsAgo);
    const recentlyTraded = new Set<string>((recentTradeRows ?? []).map((r: any) => r.agent_id));

    const sortedAgents = [...(agents as DbAgent[])].sort((a, b) => {
      const aR = recentlyTraded.has(a.id) ? 1 : 0;
      const bR = recentlyTraded.has(b.id) ? 1 : 0;
      return aR - bR; // agents that just traded go to the end
    });

    // Get Alpaca positions once (shared paper account)
    const alpacaPositions = await getPositions();

    // ── Run agents sequentially with inter-agent spacing ──────
    const results: ExecutionResult[] = [];
    for (let i = 0; i < sortedAgents.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 500)); // spread load
      setCurrentAgent(sortedAgents[i].id);
      const result = await runAgent(supabase, sortedAgents[i], alpacaPositions);
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
    const dailyLossLimit = budget * 0.03; // 3% daily loss limit
    if (dailyPnl <= -dailyLossLimit) {
      await logExecution(supabase, agent, {
        action: "skipped",
        skip_reason: `Daily loss limit hit (3%) — $${Math.abs(dailyPnl).toFixed(2)} lost today`,
      });
      return { ...base, skipped: true, skipReason: `Daily loss limit hit ($${Math.abs(dailyPnl).toFixed(2)} — 3% of budget)` };
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
      await logExecution(supabase, agent, { action: "skipped", skip_reason: "Budget fully deployed" });
      return { ...base, skipped: true, skipReason: "Budget fully deployed" };
    }

    // ── Consecutive no-signal detection ──────────────────────
    // If the last 3 runs all had no signal, temporarily loosen thresholds by 10%
    const { data: recentLogs } = await supabase
      .from("agent_logs")
      .select("signal_detected")
      .eq("agent_id", agent.id)
      .order("timestamp", { ascending: false })
      .limit(3);
    const recentLogArr = recentLogs ?? [];
    const consecutiveNoSignal =
      recentLogArr.length >= 3 &&
      recentLogArr.every((log: any) => !log.signal_detected);

    const enrichedConfig = consecutiveNoSignal
      ? { ...config, _loosen: 1 }
      : config;

    // ── Run strategy ─────────────────────────────────────────
    const signal = await runStrategy(agent.strategy, enrichedConfig, agentPositions, agentAvgCost);
    if (!signal) {
      await logExecution(supabase, agent, {
        action: "skipped",
        skip_reason: "No signal generated",
        ai_reasoning: getLastStrategyDiagnostics(),
      });
      return { ...base, skipped: true, skipReason: "No signal generated" };
    }

    // ── Resolve notional → dollar amount ─────────────────────
    // For buys: notional is a % of budget.  For sells: notional is total $ (may be partial).
    let dollarAmount: number;
    if (signal.side === "buy") {
      dollarAmount = Math.min(budget * (signal.notional / 100), availableBudget);
    } else {
      dollarAmount = signal.notional; // already in dollars (full or partial)
    }

    if (dollarAmount < 1) {
      await logExecution(supabase, agent, { action: "skipped", skip_reason: "Trade size too small", signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
      return { ...base, skipped: true, skipReason: "Trade size too small" };
    }

    // ── Portfolio concentration check (40% max per symbol) ───
    if (signal.side === "buy") {
      const currentPositionValue = (agentPositions[signal.symbol] ?? 0) * (agentAvgCost[signal.symbol] ?? signal.marketData.currentPrice);
      const projectedValue = currentPositionValue + dollarAmount;
      if (projectedValue > budget * 0.40) {
        const skipReason = `Would exceed 40% portfolio concentration in ${signal.symbol}`;
        await logExecution(supabase, agent, { action: "skipped", skip_reason: skipReason, signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
        return { ...base, skipped: true, skipReason };
      }
    }

    // ── AI confirmation ───────────────────────────────────────
    // Some strategies (News Trader, Blind Quant) already made the Groq decision
    // internally — skip confirmTrade and use their result directly.
    const aiThreshold = config.aggressive_mode ? 0.30 : 0.45;
    let ai: { execute: boolean; reasoning: string; confidence: number };

    if (signal.skipAiConfirmation) {
      ai = {
        execute:    signal.strategyConfidence >= aiThreshold,
        reasoning:  signal.reason,
        confidence: signal.strategyConfidence,
      };
    } else {
      ai = await confirmTrade({
        strategy: agent.strategy,
        symbol:   signal.symbol,
        side:     signal.side,
        reason:   signal.reason,
        ...signal.marketData,
      });
    }

    if (!ai.execute || ai.confidence < aiThreshold) {
      const skipReason = `AI rejected (confidence ${(ai.confidence * 100).toFixed(0)}%): ${ai.reasoning}`;
      await logExecution(supabase, agent, {
        action: "skipped",
        skip_reason: skipReason,
        signal_detected: true,
        signal_symbol: signal.symbol,
        signal_side: signal.side,
        ai_reasoning: ai.reasoning,
        ai_confidence: ai.confidence,
      });
      return { ...base, skipped: true, skipReason };
    }

    // ── Calculate quantity ────────────────────────────────────
    const currentPrice = signal.marketData.currentPrice;
    const rawQty = dollarAmount / currentPrice;
    // For partial sells: qty is derived from dollarAmount, capped at position size
    const qty = signal.side === "sell"
      ? Math.min(Math.floor(dollarAmount / currentPrice), Math.floor(agentPositions[signal.symbol] ?? 0))
      : Math.floor(rawQty);

    if (qty <= 0) {
      await logExecution(supabase, agent, { action: "skipped", skip_reason: "Qty rounds to 0", signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
      return { ...base, skipped: true, skipReason: "Qty rounds to 0" };
    }

    // ── Place Alpaca paper order ──────────────────────────────
    let fillPrice = currentPrice;
    let alpacaOrderId: string | null = null;
    let orderStatus: string = "simulated";
    try {
      const order = await placeOrder(signal.symbol, qty, signal.side);
      // filled_avg_price may be null until filled; fall back to current price
      fillPrice = Number(order.filled_avg_price ?? currentPrice);
      alpacaOrderId = order.id ?? null;
      orderStatus = order.status ?? "accepted";
    } catch (err) {
      console.error("Alpaca order error:", err);
      orderStatus = "rejected";
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
      order_id: alpacaOrderId,
      order_status: orderStatus,
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

    const executionResult: ExecutionResult = {
      ...base,
      success: true,
      symbol: signal.symbol,
      side: signal.side,
      qty,
      price: fillPrice,
      pnl: tradePnl,
      aiReasoning: ai.reasoning,
    };

    await logExecution(supabase, agent, {
      action: "traded",
      signal_detected: true,
      signal_symbol: signal.symbol,
      signal_side: signal.side,
      ai_reasoning: ai.reasoning,
      ai_confidence: ai.confidence,
      trade_symbol: signal.symbol,
      trade_qty: qty,
      trade_price: fillPrice,
      trade_pnl: tradePnl,
    });

    return executionResult;
  } catch (err) {
    console.error(`Agent ${agent.id} error:`, err);
    await logExecution(supabase, agent, { action: "error", skip_reason: String(err) });
    return { ...base, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────
// Agent execution logger
// ─────────────────────────────────────────────────────────────
async function logExecution(
  supabase: ReturnType<typeof createClient>,
  agent: DbAgent,
  fields: Partial<AgentLogInsert>
): Promise<void> {
  try {
    await supabase.from("agent_logs").insert({
      agent_id: agent.id,
      user_id: agent.user_id,
      agent_name: agent.name,
      strategy: agent.strategy,
      signal_detected: false,
      action: "skipped",
      ...fields,
    });
  } catch (err) {
    // Non-fatal: log errors should never crash the agent run
    console.error("Failed to write agent_log:", err);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
