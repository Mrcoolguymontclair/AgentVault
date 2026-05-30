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

      let alpacaPositions = await getPositions();

      // ── Short-position cleanup (long-only agents only) ──────
      // Short selling is OPT-IN per agent (rule 8). For long-only agents
      // (can_short=false) any negative-qty position — left over from the
      // pre-overhaul shorts era — is force-closed before the agent runs its
      // normal cycle (a no-op once flat). Agents with can_short=true keep
      // their shorts.
      if (!agent.can_short) {
        await closeAllShorts(supabase, alpacaPositions, agent);
        alpacaPositions = await getPositions();
      }

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
      } else if (agent.can_short) {
        // Sell with shorting enabled: close longs first, then sell-to-open.
        // Once long qty is exhausted the net position goes negative (a short),
        // tracking the short's weighted-avg entry price for later cover P&L.
        if (prevQty <= 0) {
          // Adding to / opening a short.
          const prevShortQty = -prevQty;
          const prevAvg = agentAvgCost[sym] ?? 0;
          const newShortQty = prevShortQty + tradeQty;
          agentAvgCost[sym] = prevShortQty > 0
            ? (prevAvg * prevShortQty + Number(t.price) * tradeQty) / newShortQty
            : Number(t.price);
          agentPositions[sym] = -newShortQty;
          if (prevQty === 0 && !agentPositionOpenedAt[sym]) {
            agentPositionOpenedAt[sym] = t.executed_at;
          }
        } else if (tradeQty > prevQty) {
          // Sell crosses from long, through flat, into a short.
          agentPositions[sym] = -(tradeQty - prevQty);
          agentAvgCost[sym] = Number(t.price);
          agentPositionOpenedAt[sym] = t.executed_at;
        } else {
          // Partial / full long close.
          agentPositions[sym] = prevQty - tradeQty;
          if (agentPositions[sym] === 0) {
            delete agentPositionOpenedAt[sym];
          }
        }
      } else {
        // Sell — long-close only (long-only agent).
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
      agent.can_short === true,
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
  const canShort = agent.can_short === true;
  const currentHeldQty = agentPositions[signal.symbol] ?? 0;
  // Trade classification (rule 8: shorting is opt-in per agent):
  //   isCover     — buy that reduces an existing short (currentHeldQty < 0)
  //   isShortOpen — sell on a flat/short symbol → sell-to-open a short
  //   isLongBuy   — buy that opens/adds a long
  //   isLongClose — sell that closes a long
  const isCover = canShort && signal.side === "buy" && currentHeldQty < 0;
  const isShortOpen = canShort && signal.side === "sell" && !isExit && currentHeldQty <= 0;
  const isLongBuy = signal.side === "buy" && !isCover;
  const isLongClose = signal.side === "sell" && !isShortOpen;
  const isEntry = (isLongBuy || isShortOpen) && !isExit; // new position → entry gates apply

  // ── Resolve notional → dollar amount ─────────────────────
  // Entries (long buy / short open): notional = % of budget.
  // Closes  (long close / cover):    notional = $ value to close.
  let dollarAmount: number;
  if (isLongBuy) {
    dollarAmount = Math.min(budget * (signal.notional / 100), availableBudget);
  } else if (isShortOpen) {
    // Short proceeds aren't cash, so don't cap by availableBudget — the
    // concentration cap below bounds short exposure to MAX_POSITION_PCT.
    dollarAmount = budget * (signal.notional / 100);
  } else {
    dollarAmount = signal.notional;
  }

  if (dollarAmount < 1) {
    await logExecution(supabase, agent, { action: "skipped", skip_reason: "Trade size too small", signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
    return { ...base, skipped: true, skipReason: "Trade size too small" };
  }

  // ── Entry gates (apply to new longs AND new shorts; skipped for exits) ──
  if (isEntry) {
    if (isLongBuy && availableBudget < 1) {
      await logExecution(supabase, agent, { action: "skipped", skip_reason: "Budget fully deployed" });
      return { ...base, skipped: true, skipReason: "Budget fully deployed" };
    }

    // Hard price floor (rule 9) — same $20 floor for longs and shorts
    if (signal.marketData.currentPrice < MIN_PRICE) {
      const skipReason = `[FILTER] ${signal.symbol} rejected: price $${signal.marketData.currentPrice.toFixed(2)} < $${MIN_PRICE} minimum`;
      console.log(skipReason);
      await logExecution(supabase, agent, { action: "skipped", skip_reason: skipReason, signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
      return { ...base, skipped: true, skipReason };
    }

    // 25% concentration cap (absolute exposure — covers shorts too)
    const currentPositionValue = Math.abs(agentPositions[signal.symbol] ?? 0) * (signal.marketData.currentPrice);
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

    // Max open positions (rule 10) — counts any non-flat position (long or short)
    const openPositions = Object.entries(agentPositions).filter(([, q]) => Math.abs(q) > 0.00001);
    const alreadyHeld = Math.abs(agentPositions[signal.symbol] ?? 0) > 0;
    if (!alreadyHeld && openPositions.length >= MAX_OPEN_POSITIONS) {
      const skipReason = `Max positions reached (${openPositions.length}/${MAX_OPEN_POSITIONS}) — skipping new ${signal.symbol}`;
      await logExecution(supabase, agent, { action: "skipped", skip_reason: skipReason, signal_detected: true, signal_symbol: signal.symbol, signal_side: signal.side });
      return { ...base, skipped: true, skipReason };
    }
  }

  // ── AI confirmation (skipped for exits and strategies that pre-decided) ─
  let ai: { execute: boolean; reasoning: string; confidence: number };
  if (isExit || isCover || signal.skipAiConfirmation) {
    ai = {
      execute: signal.strategyConfidence >= AI_CONFIDENCE_FLOOR || isExit || isCover,
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

  if (!isExit && !isCover && (!ai.execute || ai.confidence < AI_CONFIDENCE_FLOOR)) {
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
  if (isShortOpen) {
    qty = Math.floor(rawQty); // new short — size against budget, no held to clamp to
  } else if (signal.side === "sell") {
    qty = Math.min(Math.floor(rawQty), Math.floor(Math.max(0, currentHeld))); // long close
  } else if (isCover) {
    qty = Math.min(Math.floor(rawQty), Math.floor(Math.abs(Math.min(0, currentHeld)))); // cover ≤ short qty
  } else {
    qty = Math.floor(rawQty); // long buy
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
  // Entries (long buy / short open) realize $0. Long closes and short covers
  // realize P&L against their respective entry price.
  let tradePnl = 0;
  if (isCover) {
    // Buy-to-cover: profit when cover price < short entry. Short entry avg comes
    // from the trade-reconstruction map (rpc_get_agent_avg_cost is long-only).
    const shortEntry = agentAvgCost[signal.symbol] ?? 0;
    const alpacaAvgPrice = Number(alpacaPositions[signal.symbol]?.avg_entry_price ?? 0);
    const entry = shortEntry > 0 ? shortEntry : alpacaAvgPrice;
    if (entry > 0) {
      tradePnl = (entry - fillPrice) * qty;
      console.log(`[pnl] COVER ${signal.symbol}: ($${entry.toFixed(2)} - $${fillPrice.toFixed(2)}) × ${qty} = $${tradePnl.toFixed(2)}`);
    } else {
      console.warn(`[pnl] COVER ${signal.symbol} (agent: ${agent.name}): short entry unresolvable — recording pnl=0.`);
    }
  } else if (isLongClose) {
    const { data: sqlAvgCost } = await supabase.rpc("rpc_get_agent_avg_cost", {
      p_agent_id: agent.id,
      p_symbol: signal.symbol,
    });
    const alpacaAvgPrice = Number(alpacaPositions[signal.symbol]?.avg_entry_price ?? 0);

    let avgCost: number | null = null;
    if (sqlAvgCost != null && Number(sqlAvgCost) > 0) {
      avgCost = Number(sqlAvgCost);
      console.log(`[pnl] SELL ${signal.symbol}: SQL avg cost $${avgCost.toFixed(2)}`);
    } else if (alpacaAvgPrice > 0) {
      avgCost = alpacaAvgPrice;
      console.log(`[pnl] SELL ${signal.symbol}: SQL avg cost missing — using Alpaca avg_entry_price $${avgCost.toFixed(2)}`);
    } else {
      console.error(`[pnl] SELL ${signal.symbol} (agent: ${agent.name}): avg cost unresolvable from both SQL and Alpaca.`);
      throw new Error(`[pnl] SELL ${signal.symbol} (agent: ${agent.name}): avg cost unresolvable from both SQL and Alpaca.`);
    }

    tradePnl = (fillPrice - avgCost) * qty;
    console.log(`[pnl] SELL ${signal.symbol}: ($${fillPrice.toFixed(2)} - $${avgCost.toFixed(2)}) × ${qty} = $${tradePnl.toFixed(2)}`);
  }

  // ── Log trade ───────────────────────────────────────────
  const { error: tradeErr } = await supabase.rpc("rpc_insert_trade", {
    p_agent_id:        agent.id,
    p_user_id:         agent.user_id,
    p_symbol:          signal.symbol,
    p_side:            signal.side,
    p_quantity:        qty,
    p_price:           fillPrice,
    p_pnl:             tradePnl,
    p_alpaca_order_id: alpacaOrderId ?? null,
    p_order_status:    orderStatus ?? null,
  });

  if (tradeErr) throw new Error(`rpc_insert_trade failed: ${tradeErr.message}`);

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

  try {
    const { error: pvErr } = await supabase.rpc("rpc_calculate_portfolio_value", { p_user_id: agent.user_id });
    if (pvErr) console.warn("[rpc_calculate_portfolio_value] Non-fatal error:", pvErr.message);
  } catch (err) {
    console.warn("[rpc_calculate_portfolio_value] Non-fatal error:", err);
  }

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
/**
 * Force-close every short position visible on Alpaca for the active key set.
 * Buys back any qty < 0 with a market order. Runs once per agent per cron tick;
 * idempotent — once positions are flat it does nothing.
 */
async function closeAllShorts(
  supabase: ReturnType<typeof createClient>,
  positions: Record<string, { qty: number; avg_entry_price: number }>,
  agent: DbAgent,
): Promise<void> {
  for (const [symbol, p] of Object.entries(positions)) {
    if (p.qty >= 0) continue;
    const coverQty = Math.abs(Math.floor(p.qty));
    if (coverQty <= 0) continue;
    try {
      console.log(`[closeAllShorts] ${agent.name} covering ${coverQty} ${symbol} (short qty=${p.qty})`);
      const order = await placeOrder(symbol, coverQty, "buy");
      const shortEntryPrice = Number(p.avg_entry_price);
      const coverFillPrice  = Number(order.filled_avg_price ?? p.avg_entry_price);
      const coverPnl        = (shortEntryPrice - coverFillPrice) * coverQty;

      console.log(
        `[closeAllShorts] ${agent.name} covered ${coverQty} ${symbol}: ` +
        `entry=$${shortEntryPrice.toFixed(2)} fill=$${coverFillPrice.toFixed(2)} ` +
        `pnl=$${coverPnl.toFixed(2)}`
      );

      const { error: insertErr } = await supabase.rpc("rpc_insert_trade", {
        p_agent_id:        agent.id,
        p_user_id:         agent.user_id,
        p_symbol:          symbol,
        p_side:            "buy",
        p_quantity:        coverQty,
        p_price:           coverFillPrice,
        p_pnl:             coverPnl,
        p_alpaca_order_id: order.id ?? null,
        p_order_status:    order.status ?? "filled",
      });
      if (insertErr) {
        console.error(`[closeAllShorts] rpc_insert_trade failed for ${symbol}:`, insertErr.message);
      }

      const { error: statsErr } = await supabase.rpc("rpc_update_agent_stats", { p_agent_id: agent.id });
      if (statsErr) {
        console.error(`[closeAllShorts] rpc_update_agent_stats failed for ${agent.name}:`, statsErr.message);
      }
    } catch (err) {
      console.error(`[closeAllShorts] failed to cover ${symbol}:`, err);
    }
  }
}

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
