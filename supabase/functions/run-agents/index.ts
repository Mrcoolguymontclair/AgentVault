import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isMarketOpen } from "./market-utils.ts";
import { confirmTrade } from "./groq.ts";
import { placeOrder, getPositions, setAlpacaKeys, clearAlpacaKeys } from "./alpaca.ts";
import {
  runStrategy,
  managePositions,
  clearMarketCache,
  getLastStrategyDiagnostics,
  MAX_OPEN_POSITIONS,
  MAX_POSITION_PCT,
  AI_CONFIDENCE_FLOOR,
  MIN_PRICE,
} from "./strategies.ts";
import { initTracker, setCurrentAgent, setCustomKeys, type CustomKey } from "./groq-tracker.ts";
import type { DbAgent, ExecutionResult, AgentLogInsert, TradeSignal } from "./types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Daily limits — entries only. Exits always go through.
const DAILY_ENTRY_LIMIT = 2;
const DAILY_LOSS_LIMIT_PCT = 0.03;

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

    if (!body.force && !isMarketOpen()) {
      return json({ ok: true, marketClosed: true, message: "Market is closed — no agents run", results: [] });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });

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

    const { data: dailyTokenData } = await supabase.rpc("rpc_get_groq_usage_today");
    initTracker(supabase, Number(dailyTokenData ?? 0));

    clearMarketCache();

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
      return aR - bR;
    });

    const results: ExecutionResult[] = [];
    for (let i = 0; i < sortedAgents.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 500));

      const agent = sortedAgents[i];

      if (agent.mode === "live") {
        try {
          const { data: alpacaKeys } = await supabase.rpc("rpc_get_user_alpaca_keys", {
            p_user_id: agent.user_id,
          });
          if (alpacaKeys?.key_id && alpacaKeys?.key_secret) {
            setAlpacaKeys(alpacaKeys.key_id, alpacaKeys.key_secret, true);
          } else {
            console.warn(`[run-agents] Live agent ${agent.id} has no Alpaca keys — pausing`);
            await supabase.from("agents").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", agent.id);
            results.push({ agentId: agent.id, agentName: agent.name, success: false, skipped: true, skipReason: "No Alpaca keys configured for live trading" });
            continue;
          }
        } catch (err) {
          console.error(`[run-agents] Failed to load Alpaca keys for live agent ${agent.id}:`, err);
          results.push({ agentId: agent.id, agentName: agent.name, success: false, error: "Failed to load Alpaca keys" });
          continue;
        }
      } else {
        clearAlpacaKeys();
      }

      const alpacaPositions = await getPositions();

      try {
        const { data: customKeyData } = await supabase.rpc("rpc_get_key_for_agent", {
          p_user_id: agent.user_id,
        });
        setCustomKeys((customKeyData as CustomKey[] | null) ?? []);
      } catch (err) {
        console.warn(`[run-agents] Could not load custom keys for user ${agent.user_id}:`, err);
        setCustomKeys([]);
      }

      setCurrentAgent(agent.id);
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

    // ── Daily loss limit ────────────────────────────────────
    const today = new Date().toISOString().split("T")[0];
    const { data: todayTrades } = await supabase
      .from("trades")
      .select("pnl, side, symbol, executed_at")
      .eq("agent_id", agent.id)
      .gte("executed_at", `${today}T00:00:00Z`);

    const dailyPnl = (todayTrades ?? []).reduce((s, t) => s + Number(t.pnl), 0);
    const dailyLossLimit = budget * DAILY_LOSS_LIMIT_PCT;
    if (dailyPnl <= -dailyLossLimit) {
      await logExecution(supabase, agent, {
        action: "skipped",
        skip_reason: `Daily loss limit hit (3%) — $${Math.abs(dailyPnl).toFixed(2)} lost today`,
      });
      return { ...base, skipped: true, skipReason: `Daily loss limit hit ($${Math.abs(dailyPnl).toFixed(2)} — 3% of budget)` };
    }

    // ── Calculate agent's virtual positions (longs only) ────
    const { data: allTrades } = await supabase
      .from("trades")
      .select("symbol, side, quantity, price, executed_at")
      .eq("agent_id", agent.id)
      .order("executed_at", { ascending: true });

    const agentPositions: Record<string, number> = {};
    const agentAvgCost: Record<string, number> = {};
    const agentPositionOpenedAt: Record<string, string> = {};
    const agentLastBuyAt: Record<string, string> = {};

    for (const t of allTrades ?? []) {
      const tradeQty = Number(t.quantity);
      const sym = t.symbol;
      const prevQty = agentPositions[sym] ?? 0;

      if (t.side === "buy") {
        const prevAvg = agentAvgCost[sym] ?? 0;
        agentAvgCost[sym] = prevQty > 0
          ? (prevAvg * prevQty + Number(t.price) * tradeQty) / (prevQty + tradeQty)
          : Number(t.price);
        agentPositions[sym] = prevQty + tradeQty;
        if (prevQty === 0 && !agentPositionOpenedAt[sym]) {
          agentPositionOpenedAt[sym] = t.executed_at;
        }
        agentLastBuyAt[sym] = t.executed_at;
      } else {
        // Sell — long-close only (shorts disabled).
        agentPositions[sym] = Math.max(0, prevQty - tradeQty);
        if (agentPositions[sym] === 0) {
          delete agentPositionOpenedAt[sym];
        }
      }
    }

    // ── Available budget ────────────────────────────────────
    const invested = Object.entries(agentPositions).reduce((sum, [sym, qty]) => {
      if (qty <= 0) return sum;
      const price = alpacaPositions[sym]?.avg_entry_price ?? agentAvgCost[sym] ?? 0;
      return sum + qty * price;
    }, 0);
    const availableBudget = Math.max(0, budget - invested);

    // ─────────────────────────────────────────────────────────
    // STEP 1: EXIT ENGINE — runs BEFORE strategy evaluation.
    // Stop-loss / take-profit / time-stop are more important than entries.
    // Exit signals bypass daily-entry-limit and AI confirmation.
    // ─────────────────────────────────────────────────────────
    const exitSignal = await managePositions(
      agent.strategy,
      agentPositions,
      agentAvgCost,
      agentPositionOpenedAt,
    );

    if (exitSignal) {
      const result = await executeSignal(supabase, agent, exitSignal, agentPositions, agentAvgCost, alpacaPositions, budget, availableBudget);
      return result;
    }

    // ─────────────────────────────────────────────────────────
    // STEP 2: ENTRY EVALUATION — apply daily-entry-limit and run strategy.
    // ─────────────────────────────────────────────────────────
    const entryCountToday = (todayTrades ?? []).filter((t: any) => t.side === "buy").length;
    if (entryCountToday >= DAILY_ENTRY_LIMIT) {
      await logExecution(supabase, agent, {
        action: "skipped",
        skip_reason: `Daily entry limit reached (${entryCountToday}/${DAILY_ENTRY_LIMIT} buys today)`,
      });
      return { ...base, skipped: true, skipReason: `Daily entry limit reached (${entryCountToday}/${DAILY_ENTRY_LIMIT} buys today)` };
    }

    // ── Run strategy ────────────────────────────────────────
    const signal = await runStrategy(
      agent.strategy,
      config,
      agentPositions,
      agentAvgCost,
      agentPositionOpenedAt,
      agentLastBuyAt,
    );
    if (!signal) {
      await logExecution(supabase, agent, {
        action: "skipped",
        skip_reason: "No signal generated",
        ai_reasoning: getLastStrategyDiagnostics(),
      });
      return { ...base, skipped: true, skipReason: "No signal generated" };
    }

    const result = await executeSignal(supabase, agent, signal, agentPositions, agentAvgCost, alpacaPositions, budget, availableBudget);
    return result;
  } catch (err) {
    console.error(`Agent ${agent.id} error:`, err);
    await logExecution(supabase, agent, { action: "error", skip_reason: String(err) });
    return { ...base, error: String(err) };
  }
}

// ─────────────────────────────────────────────────────────────
// Execute a single TradeSignal (entry or exit).
// Returns an ExecutionResult.
// ─────────────────────────────────────────────────────────────
async function executeSignal(
  supabase: ReturnType<typeof createClient>,
  agent: DbAgent,
  signal: TradeSignal,
  agentPositions: Record<string, number>,
  agentAvgCost: Record<string, number>,
  alpacaPositions: Record<string, { qty: number; avg_entry_price: number }>,
  budget: number,
  availableBudget: number,
): Promise<ExecutionResult> {
  const base: ExecutionResult = { agentId: agent.id, agentName: agent.name, success: false };

  const isExit = signal.isExit === true;
  const isLongBuy = signal.side === "buy";

  // ── Resolve notional → dollar amount ─────────────────────
  // Long buy:  notional = % of budget
  // Sell:      notional = $ value to close
  let dollarAmount: number;
  if (isLongBuy) {
    dollarAmount = Math.min(budget * (signal.notional / 100), availableBudget);
  } else {
    dollarAmount = signal.notional;
  }

  if (dollarAmount < 1) {
    await logExecution(supabase, agent, { action: "skipped", skip_reason: "Trade size too small", signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
    return { ...base, skipped: true, skipReason: "Trade size too small" };
  }

  // ── Entry gates (skipped for exits) ──────────────────────
  if (isLongBuy && !isExit) {
    if (availableBudget < 1) {
      await logExecution(supabase, agent, { action: "skipped", skip_reason: "Budget fully deployed" });
      return { ...base, skipped: true, skipReason: "Budget fully deployed" };
    }

    // Hard price floor
    if (signal.marketData.currentPrice < MIN_PRICE) {
      const skipReason = `[FILTER] ${signal.symbol} rejected: price $${signal.marketData.currentPrice.toFixed(2)} < $${MIN_PRICE} minimum`;
      console.log(skipReason);
      await logExecution(supabase, agent, { action: "skipped", skip_reason: skipReason, signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
      return { ...base, skipped: true, skipReason };
    }

    // 25% concentration cap
    const currentPositionValue = (agentPositions[signal.symbol] ?? 0) * (signal.marketData.currentPrice);
    const projectedValue = currentPositionValue + dollarAmount;
    if (projectedValue > budget * MAX_POSITION_PCT) {
      // Reduce dollarAmount to fit within the cap
      const allowed = budget * MAX_POSITION_PCT - currentPositionValue;
      if (allowed < 1) {
        const skipReason = `Already at ${(MAX_POSITION_PCT * 100).toFixed(0)}% concentration in ${signal.symbol}`;
        await logExecution(supabase, agent, { action: "skipped", skip_reason: skipReason, signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
        return { ...base, skipped: true, skipReason };
      }
      dollarAmount = allowed;
    }

    // Max open positions (counts existing longs)
    const openPositions = Object.entries(agentPositions).filter(([, q]) => q > 0.00001);
    const alreadyHeld = (agentPositions[signal.symbol] ?? 0) > 0;
    if (!alreadyHeld && openPositions.length >= MAX_OPEN_POSITIONS) {
      const skipReason = `Max positions reached (${openPositions.length}/${MAX_OPEN_POSITIONS}) — skipping new ${signal.symbol}`;
      await logExecution(supabase, agent, { action: "skipped", skip_reason: skipReason, signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
      return { ...base, skipped: true, skipReason };
    }
  }

  // ── AI confirmation (skipped for exits and strategies that pre-decided) ─
  let ai: { execute: boolean; reasoning: string; confidence: number };
  if (isExit || signal.skipAiConfirmation) {
    ai = {
      execute: signal.strategyConfidence >= AI_CONFIDENCE_FLOOR || isExit,
      reasoning: signal.reason,
      confidence: signal.strategyConfidence,
    };
  } else {
    ai = await confirmTrade({
      strategy: agent.strategy,
      symbol: signal.symbol,
      side: signal.side,
      reason: signal.reason,
      ...signal.marketData,
    });
  }

  if (!isExit && (!ai.execute || ai.confidence < AI_CONFIDENCE_FLOOR)) {
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

  // ── Calculate quantity ──────────────────────────────────
  const currentPrice = signal.marketData.currentPrice;
  const rawQty = dollarAmount / currentPrice;
  const currentHeld = agentPositions[signal.symbol] ?? 0;

  let qty: number;
  if (signal.side === "sell") {
    qty = Math.min(Math.floor(rawQty), Math.floor(Math.max(0, currentHeld)));
  } else {
    qty = Math.floor(rawQty);
  }

  if (qty <= 0) {
    await logExecution(supabase, agent, { action: "skipped", skip_reason: "Qty rounds to 0", signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
    return { ...base, skipped: true, skipReason: "Qty rounds to 0" };
  }

  // ── Place Alpaca order ──────────────────────────────────
  let fillPrice = currentPrice;
  let alpacaOrderId: string | null = null;
  let orderStatus = "simulated";
  try {
    const order = await placeOrder(signal.symbol, qty, signal.side);
    fillPrice = Number(order.filled_avg_price ?? currentPrice);
    alpacaOrderId = order.id ?? null;
    orderStatus = order.status ?? "filled";
    console.log(`[order] ${signal.symbol} ${signal.side} orderId=${alpacaOrderId} status=${orderStatus}`);
  } catch (err) {
    console.error("Alpaca order error:", err);
  }

  // ── P&L ─────────────────────────────────────────────────
  let tradePnl = 0;
  if (signal.side === "sell") {
    let avgCost = agentAvgCost[signal.symbol] ?? 0;
    const alpacaAvgPrice = Number(alpacaPositions[signal.symbol]?.avg_entry_price ?? 0);
    if (avgCost <= 0 && alpacaAvgPrice > 0) {
      console.log(`[pnl] SELL ${signal.symbol}: local avgCost missing — using Alpaca avg_entry_price $${alpacaAvgPrice.toFixed(2)}`);
      avgCost = alpacaAvgPrice;
    }
    if (avgCost > 0) {
      tradePnl = (fillPrice - avgCost) * qty;
      console.log(`[pnl] SELL ${signal.symbol}: ($${fillPrice.toFixed(2)} - $${avgCost.toFixed(2)}) × ${qty} = $${tradePnl.toFixed(2)}`);
    } else {
      console.error(`[pnl] SELL ${signal.symbol}: avg cost missing in BOTH local AND Alpaca — pnl recorded as $0`);
    }
  }

  // ── Log trade ───────────────────────────────────────────
  const baseTradeRow = {
    agent_id: agent.id,
    user_id: agent.user_id,
    symbol: signal.symbol,
    side: signal.side,
    quantity: qty,
    price: fillPrice,
    pnl: tradePnl,
    executed_at: new Date().toISOString(),
  };

  const { error: tradeErr } = await supabase.from("trades").insert(
    alpacaOrderId
      ? { ...baseTradeRow, alpaca_order_id: alpacaOrderId, order_status: orderStatus }
      : baseTradeRow
  );

  if (tradeErr) {
    if (tradeErr.message.includes("alpaca_order_id") || tradeErr.message.includes("order_status")) {
      console.warn("[trades.insert] Retrying without order tracking cols:", tradeErr.message);
      const { error: retryErr } = await supabase.from("trades").insert(baseTradeRow);
      if (retryErr) throw new Error(`Trade insert failed: ${retryErr.message}`);
    } else {
      throw new Error(`Trade insert failed: ${tradeErr.message}`);
    }
  }

  // ── Update agent stats ──────────────────────────────────
  const { error: statsRpcErr } = await supabase.rpc("rpc_update_agent_stats", { p_agent_id: agent.id });
  if (statsRpcErr) {
    console.warn("[rpc_update_agent_stats] RPC missing — using inline fallback:", statsRpcErr.message);
    const newPnl = Number(agent.pnl) + tradePnl;
    const newPnlPct = budget > 0 ? (newPnl / budget) * 100 : 0;
    const newTrades = agent.trades_count + 1;
    const { data: sellTrades } = await supabase
      .from("trades").select("pnl").eq("agent_id", agent.id).eq("side", "sell");
    const sells = sellTrades ?? [];
    const winners = sells.filter((t) => Number(t.pnl) > 0).length;
    const newWinRate = sells.length > 0 ? (winners / sells.length) * 100 : 0;
    await supabase.from("agents").update({
      pnl: newPnl, pnl_pct: newPnlPct, trades_count: newTrades,
      win_rate: newWinRate, updated_at: new Date().toISOString(),
    }).eq("id", agent.id);
  }

  // ── Portfolio snapshot ──────────────────────────────────
  const today = new Date().toISOString().split("T")[0];
  const { data: allAgentTrades } = await supabase
    .from("trades")
    .select("pnl")
    .eq("agent_id", agent.id);
  const cumulativePnl = (allAgentTrades ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const portfolioValue = budget + cumulativePnl;
  const snapshotPnlPct = budget > 0 ? (cumulativePnl / budget) * 100 : 0;

  await supabase.from("portfolio_snapshots").upsert(
    {
      user_id: agent.user_id,
      agent_id: agent.id,
      value: portfolioValue,
      pnl_pct: snapshotPnlPct,
      snapshot_date: today,
    },
    { onConflict: "user_id,agent_id,snapshot_date" }
  );

  supabase.rpc("rpc_calculate_portfolio_value", { p_user_id: agent.user_id }).catch((err) => {
    console.warn("[rpc_calculate_portfolio_value] Non-fatal error:", err);
  });

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
}

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
    console.error("Failed to write agent_log:", err);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
