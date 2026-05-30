# AgentVault — Bug List & Sonnet Prompts

---

## ⚡ CURRENT STATUS — updated 2026-05-30 (after portfolio reset + shorts rework)

**Shipped (deployed + pushed):** BUG-001, BUG-002 (migration 025 applied), BUG-007, BUG-003, BUG-004, BUG-008.

**Remaining:** BUG-005 (concentration trim) and BUG-009 (`.from()` cleanup) — both **HELD until after the Monday 2026-06-01 15:00 UTC engine-verification routine** (`trig_01AF1n6ybA1bbvk4SK2ZcdRe`) reports clean, so they refactor on a verified base.

**⚠️ The original BUG-009 prompt further down this file (~line 260) is STALE** — wrong line numbers, says migration 026 / 5 RPCs. Migration 026 is now used by `can_short`. Use THIS updated version instead (migration **027**, 10 actual call sites, + delete the dead stats fallback):

```
Read CLAUDE.md.

BUG-009: remove all 10 `.from()` calls in supabase/functions/run-agents/index.ts (CLAUDE.md rule 1 violation). Write ONE migration 027_run_agents_rpcs.sql (026 is taken by can_short) adding the RPCs below, then convert each call site. Every RPC: SECURITY DEFINER, SET search_path=public, GRANT EXECUTE TO anon, authenticated — match the style of existing RPCs in supabase/migrations/.

RPCs to add:
1. rpc_get_runnable_agents(p_agent_id uuid DEFAULT NULL, p_force boolean DEFAULT false) RETURNS SETOF agents — p_agent_id NULL → all status='active'; else that agent, requiring status='active' unless p_force. (line 53 + the .eq filters 55-56)
2. rpc_agents_traded_since(p_agent_ids uuid[], p_since timestamptz) RETURNS TABLE(agent_id uuid) — distinct agent_ids with a trade executed_at >= p_since. (lines 73-77)
3. rpc_pause_agent(p_agent_id uuid) RETURNS void — UPDATE agents SET status='paused', updated_at=now() WHERE id=p_agent_id. (line 101)
4. rpc_get_today_trades_for_agent(p_agent_id uuid) RETURNS TABLE(pnl numeric, side trade_side, symbol text, executed_at timestamptz) — agent trades since today 00:00 UTC. (lines 168-172)
5. rpc_get_agent_trade_history(p_agent_id uuid) RETURNS TABLE(symbol text, side trade_side, quantity numeric, price numeric, executed_at timestamptz) — all agent trades, executed_at ASC. (lines 185-189)
6. rpc_sum_agent_pnl(p_agent_id uuid) RETURNS numeric — COALESCE(SUM(pnl),0). (lines 550-552)
7. rpc_upsert_portfolio_snapshot(p_user_id uuid, p_agent_id uuid, p_value numeric, p_pnl_pct numeric, p_date date) RETURNS void — upsert into portfolio_snapshots; READ the current .upsert at line 557 to match its onConflict target + full column set. (line 557)
8. rpc_insert_agent_log(...) RETURNS void — READ the full object inserted at line 661 and make a param for every column it writes. (line 661, in logExecution)

DELETE, don't convert: lines 535-544 — the inline stats fallback. rpc_update_agent_stats (called at line 530) is canonical and present, so remove the entire `if (statsRpcErr) {…}` fallback body that does .from("trades").select("pnl") + .from("agents").update(...). Keep the line-530 rpc call and its warn log.

Convert every call site to `await supabase.rpc(...)` with await+if(error) checks — NEVER `.rpc(...).catch(...)` (that was BUG-001). Read each site so the RPC returns exactly the columns the TS consumes. Do NOT touch `.from()` in any other file.

Tell me to run migration 027 in the Supabase SQL editor, then deploy: supabase functions deploy run-agents --no-verify-jwt. Update CHANGELOG.
```

**BUG-005** (concentration trim) — also held until post-Monday; its original prompt (~line 165 below) needs re-pointing at the now sign-aware `managePositions` before use.

---

**Compiled by Opus (Planner) on 2026-05-25 (Memorial Day, market closed).**
**State of evidence:** Just triggered a force-run that fired all 5 agents. Cross-checked agent_logs, trades table, dashboard render, edge-function source.

Top-level finding: **the strategies are NOT the bottleneck right now — the edge function is silently miscategorizing every successful trade as an error, and historical phantom shorts are inflating the Holdings view.** Trade-frequency is also being throttled by an aggressive 2/day cap + AI gate that often rejects legitimate exits.

---

## P0 — Trade-blocking / data-integrity (fix these first)

### BUG-001 · `.catch()` on `supabase.rpc()` throws after every successful trade
**Severity:** 🔴 Critical. Every agent that successfully trades currently logs `action='error'`. Zero `action='traded'` rows in agent_logs for the past 30 days.

**Location:** `supabase/functions/run-agents/index.ts:496`
```ts
supabase.rpc("rpc_calculate_portfolio_value", { p_user_id: agent.user_id }).catch((err) => {
  console.warn("[rpc_calculate_portfolio_value] Non-fatal error:", err);
});
```

**Why it breaks:** `supabase.rpc()` in supabase-js v2 returns a `PostgrestFilterBuilder`, not a Promise. It's thenable but does **not** expose `.catch`. Calling `.catch(...)` throws `TypeError: supabase.rpc(...).catch is not a function` synchronously. This happens AFTER `rpc_insert_trade` + `rpc_update_agent_stats` + the portfolio_snapshots upsert — so trades land in the DB, but the function aborts before `logExecution(action: "traded")` runs. The outer try/catch then logs `action: "error"` instead.

**Verified by:** Today's force-run inserted 5 trades but logged 5 `action='error'` rows (same timestamps, all with `skip_reason: "TypeError: supabase.rpc(...).catch is not a function"`).

**Sonnet prompt:**
```
Read CLAUDE.md.

Fix supabase/functions/run-agents/index.ts:496 — `.catch` is being called on a supabase rpc builder, which throws "TypeError: supabase.rpc(...).catch is not a function" on every successful agent run. This kills the function before logExecution(action="traded") at line 511.

Replace lines 496-498 with:
  try {
    const { error: pvErr } = await supabase.rpc("rpc_calculate_portfolio_value", { p_user_id: agent.user_id });
    if (pvErr) console.warn("[rpc_calculate_portfolio_value] Non-fatal error:", pvErr.message);
  } catch (err) {
    console.warn("[rpc_calculate_portfolio_value] Non-fatal error:", err);
  }

After deploying, also grep the entire run-agents/ folder for other `.rpc(...).catch(` or `.rpc(...).then(...).catch(` patterns and replace with awaited + error-check. Do NOT touch `.from(...)`.then.catch (different builder, supports promise chaining).

Deploy: supabase functions deploy run-agents --no-verify-jwt
Update CHANGELOG.md.
```

---

### BUG-002 · Phantom short positions clutter Holdings (32 of 39 are fake)
**Severity:** 🔴 Critical. Owen's dashboard shows "39 positions · $5,605.89" but only **7 are real long positions on Alpaca**. The other 32 are historical `side='sell'` rows from the pre-overhaul shorts era that have no matching `buy` cover, so when the holdings RPC sums `(buy_qty − sell_qty)` it gets negative and labels them as SHORT. Alpaca itself is flat on shorts (today's `closeAllShorts` had nothing to cover).

**Evidence (SQL, agents → trade-derived qty):**
- Real longs (7): QBTS, RGTI, SOXL, INTC, UGRO, RRR, UAL, XPRO (mix across 4 agents)
- Phantom shorts (32, all under Story Seeker): ANGX, ARTL, BLNK, BOT, BTM, CBAT, CCL, CEPT, CETX, CEVA, CPNG, FSLY, GSAT, HUT, JBLU, LCID, MBLY, MSTR, MVST, NIO, PLTR, RBLX, REPL, RKLB, RYAAY, SHEL, SNBR, SPIR, TME, USO, WMT

**Why it matters:**
1. Misleading UI — Owen thinks he has 39 positions when he has 7.
2. Allocation bar / concentration math counts these as real exposure.
3. The fake shorts show unrealized P&L that has no economic meaning (already locked in via the matching short-cover buys recorded historically).

**Fix (recommended path: SQL backfill, not frontend mask):**
Pair every orphan `side='sell'` with a synthetic `side='buy'` at the same price + same qty + `pnl=0`, recorded ~1 second after the sell. That seals the round-trip in the trades table without changing any realized P&L (which is already on the historical cover rows). After the migration, `rpc_get_portfolio_holdings` will return 7 rows, not 39.

**Alternative (frontend-only):** modify `rpc_get_portfolio_holdings` to filter `WHERE net_qty > 0` (drop negative-qty rows). Faster but leaves the trades table in a state where short opens never close.

**Sonnet prompt:**
```
Read CLAUDE.md.

Write migration 025_seal_orphan_shorts.sql that pairs every "orphan sell" (side='sell' rows without enough prior buy quantity in the same agent_id+symbol) with a synthetic side='buy' row at the same price, same qty, pnl=0, executed_at = sell.executed_at + interval '1 second', alpaca_order_id=NULL, order_status='synthetic-seal'.

Algorithm:
  For each (agent_id, symbol), walk trades chronologically. Track running long qty. When a sell exceeds available long qty, the EXCESS portion is treated as a short-open. For each short-open of size N, insert a synthetic buy of size N at the same price immediately after.

After insertion, run: PERFORM rpc_update_agent_stats(agent_id) for each affected agent.

Validate: SELECT a.name, h.symbol, h.net_qty FROM (SELECT agent_id, symbol, SUM(CASE WHEN side='buy' THEN quantity ELSE -quantity END) AS net_qty FROM trades GROUP BY agent_id, symbol HAVING SUM(...) <> 0) h JOIN agents a ON a.id=h.agent_id should return ~7 rows, all positive net_qty.

Tell user to run 025 in Supabase SQL Editor. No edge function redeploy needed. Update CHANGELOG.
```

---

### BUG-003 · Agents not trading enough — multi-cause throttle
**Severity:** 🔴 Critical (Owen's #1 concern). Last 30 days: each agent ran ~561 cron ticks. Of those, ZERO logged `action='traded'` (because of BUG-001), and the rest skipped. Even setting BUG-001 aside, the actual trade-execution rate is too low:

**Skip-reason breakdown (last 7 days):**
| Skip reason | Total | Root cause |
|---|---|---|
| `No signal generated` | 343 | Strategy filters too narrow (especially Evo Bot 140, Surge Bot 98) |
| `AI rejected ... Stop-loss triggered` | ~200 | Strategies emit sells without `isExit=true`, AI rejects them (BUG-007) |
| `Daily trade limit reached (2/2)` | 41 | DAILY_ENTRY_LIMIT=2 caps Story Seeker (the only active agent) |
| `Qty rounds to 0` | ~80 | Sizing math floors to 0 on expensive tickers |
| `AI rejected ... short-term trend` | 22 | Confidence floor 0.70 too high for borderline signals |

**Recommended bundle:**

1. **Raise DAILY_ENTRY_LIMIT from 2 → 5.** With 14 cron ticks/market day and high-quality entry filters, 5 is still safe and gives strategies room.
2. **Lower AI_CONFIDENCE_FLOOR from 0.70 → 0.60** for entries.
3. **Fix the "Qty rounds to 0" bug.** Use `Math.max(1, Math.floor(rawQty))` when `rawQty >= 0.5`, OR allow fractional shares (Alpaca supports them for many tickers). Better: compute qty = `Math.floor(rawQty)` and skip ONLY if `rawQty * currentPrice < 5` (true micro-trade).
4. **Loosen RSI band** for Trend Rider from 40-65 → 35-70.
5. **Don't gate exits behind AI** (see BUG-007 — separate prompt).

**Sonnet prompt:**
```
Read CLAUDE.md.

Make four numeric tweaks to widen the trade funnel. Update CHANGELOG with a single entry covering all four.

A) supabase/functions/run-agents/index.ts:28 — change `const DAILY_ENTRY_LIMIT = 2;` to `const DAILY_ENTRY_LIMIT = 5;`

B) supabase/functions/run-agents/strategies.ts:74 — change `export const AI_CONFIDENCE_FLOOR = 0.70;` to `export const AI_CONFIDENCE_FLOOR = 0.60;`

C) supabase/functions/run-agents/index.ts:386-401 — replace the qty calculation with a less aggressive floor. Specifically:
   - For SELLS: keep `qty = Math.min(Math.floor(rawQty), Math.floor(Math.max(0, currentHeld)))` (unchanged).
   - For BUYS: change `qty = Math.floor(rawQty)` to:
       qty = Math.floor(rawQty);
       if (qty === 0 && rawQty >= 0.5) qty = 1;  // round up for borderline single-share trades
   - Keep the existing `if (qty <= 0)` skip, but only fires now when rawQty < 0.5.

D) supabase/functions/run-agents/strategies.ts — find `momentumRider` (Trend Rider) RSI band and widen from 40-65 to 35-70. Search for `rsi >= 40` and `rsi <= 65` to locate. Update the strategy description comment too.

Deploy: supabase functions deploy run-agents --no-verify-jwt
```

---

## P1 — Strategy correctness

### BUG-007 · Strategy-level sells go through AI gate (and get rejected)
**Severity:** 🟠 High. The May 23 overhaul says "exit signals bypass AI confirmation" — but only signals from `managePositions` carry `isExit=true`. Sells that strategies emit themselves (e.g., Pure Alpha → blind_quant's logic deciding to flatten a losing position) come back as regular `TradeSignal` without `isExit=true`. The executor at `index.ts:354-370` then runs them through `confirmTrade`, which calls Groq and frequently rejects.

**Evidence:** Pure Alpha's MGRX sell was rejected by AI 118 times over 7 days at 0-20% confidence ("Stop-loss triggered, signal not valid"). Yet the position WAS profitable when the force-run finally caught it ($22.18 P&L on sell).

**Fix:** When a strategy emits `side: 'sell'` on a symbol the agent already holds (`agentPositions[symbol] > 0`), treat as an exit — set `isExit: true` and `skipAiConfirmation: true` in the signal. Either:
- Each strategy sets these flags itself (more explicit), OR
- `executeSignal` infers `isExit` whenever `signal.side === 'sell' && agentPositions[signal.symbol] > 0`.

The latter is one line and covers all strategies including future ones.

**Sonnet prompt:**
```
Read CLAUDE.md.

In supabase/functions/run-agents/index.ts:297, the current code is:
  const isExit = signal.isExit === true;

Change it to infer exits from position state:
  const isExit = signal.isExit === true || (signal.side === "sell" && (agentPositions[signal.symbol] ?? 0) > 0);

This treats any sell of a symbol the agent currently holds as an exit, bypassing AI confirmation. Adds zero risk: we already own the position, AI veto on closing is just lost upside-protection.

Deploy: supabase functions deploy run-agents --no-verify-jwt
Update CHANGELOG.
```

---

### BUG-005 · Concentration cap (25%) not enforced on existing oversized positions
**Severity:** 🟠 High but slow-burn. New entries are capped at 25% of budget per position, but legacy positions opened pre-overhaul (when cap was 40%) can sit at 50%+. Example: Pure Alpha holds UGRO 31 shares × ~$17 = $527 on a $1000 budget → 52.7% concentration.

**Fix:** Add a "concentration trim" check in `managePositions` — if any single position exceeds `MAX_POSITION_PCT * 1.5` (37.5%), emit a partial-exit signal selling enough shares to bring it to MAX_POSITION_PCT.

**Sonnet prompt:**
```
Read CLAUDE.md.

Add a "concentration trim" rule to managePositions in supabase/functions/run-agents/strategies.ts, inserted ABOVE the take-profit check (around line 174):

```ts
// ── Concentration trim ──────────────────────────────────
// If a single position exceeds 37.5% of budget (= 1.5× MAX_POSITION_PCT),
// trim it back to MAX_POSITION_PCT. Sells the excess.
const positionValue = heldQty * currentPrice;
const budgetFromContext = /* TODO: pass budget into managePositions; see below */;
const trimThreshold = budgetFromContext * MAX_POSITION_PCT * 1.5;
if (positionValue > trimThreshold) {
  const targetValue = budgetFromContext * MAX_POSITION_PCT;
  const sellQty = Math.floor((positionValue - targetValue) / currentPrice);
  if (sellQty > 0) {
    console.log(`[exit] ${symbol} TRIM: position $${positionValue.toFixed(0)} > $${trimThreshold.toFixed(0)} threshold`);
    return {
      ...baseSignal,
      notional: sellQty * currentPrice,
      reason: `Concentration trim: $${positionValue.toFixed(0)} (${(positionValue/budgetFromContext*100).toFixed(0)}%) > 37.5% cap`,
    };
  }
}
```

To pass `budget` into managePositions: change its signature in strategies.ts and the caller in index.ts:230 to accept budget as a parameter.

Deploy: supabase functions deploy run-agents --no-verify-jwt
Update CHANGELOG.
```

---

### BUG-006 · Win-rate denominator double-counts historic short covers
**Severity:** 🟡 Medium. `rpc_get_portfolio_stats.closed_trades` CTE counts BOTH sells AND buys with non-zero pnl. The buys-with-pnl are legacy short covers from the pre-overhaul era. For long-only operations going forward, every closed trade is a sell, so this CTE will work fine — but historical data is inflated.

**Fix (post-BUG-002):** After 025_seal_orphan_shorts runs, you could optionally zero out the pnl on the synthetic buy rows (they aren't real covers anymore) OR leave the CTE as-is. Lower priority — comes down to whether Owen wants the historical "all-time win rate" to reflect the actual short-era trades (which is honest) or only long round-trips.

**Sonnet prompt:** Skip for now. Re-evaluate after BUG-002 ships.

---

## P2 — UX / display

### BUG-004 · Today's P&L stale after force-run from Debug screen
**Severity:** 🟡 Medium. After hitting "Force Run All Agents", dashboard initially shows yesterday's Today's P&L value. Self-corrects after a reload or once the realtime subscription updates.

**Fix:** Have the Debug screen's "Force Run" button trigger a `fetchRecentTrades(userId)` on the agentStore after the edge function returns. One-liner.

**Sonnet prompt:**
```
Read CLAUDE.md.

In app/(tabs)/debug.tsx, find the Force Run All Agents button onPress handler. After the edge function fetch resolves successfully, call `useAgentStore.getState().fetchRecentTrades(authUser.id)` (or whatever the store action is named — grep agentStore.ts).

Also call `loadHoldingsAndStats` if exposed, OR navigate to / (home) which will trigger a fresh load.

Update CHANGELOG.
```

---

### BUG-008 · Chart "No chart data yet" flashes on initial load
**Severity:** 🟢 Low. The 1M chart momentarily shows "No chart data yet" before the data arrives. Replace with a skeleton.

**Sonnet prompt:**
```
Read CLAUDE.md.

In app/(tabs)/index.tsx, find where the dashboard chart renders "No chart data yet". Wrap it in a check: if chartLoading is true OR chartData is null, render <PortfolioSkeleton /> instead. Only show "No chart data yet" if chartLoading=false AND chartData=[] (legit empty state).

Update CHANGELOG.
```

---

### BUG-009 · `.from('table')` violations in edge function (CLAUDE.md rule 1)
**Severity:** 🟡 Medium (works today, but violates the rule and may break later if PostgREST cache flips again).

**Locations:** `supabase/functions/run-agents/index.ts:165, 182, 464, 469, 477, 485` — all `.from("trades")`, `.from("agents")`, `.from("portfolio_snapshots")`.

**Fix:** Replace each with a dedicated RPC. The harder ones to convert:
- Lines 165-169 (today's trades by agent): write `rpc_get_today_trades_for_agent(p_agent_id)` returning `(pnl, side, symbol, executed_at)`.
- Lines 182-186 (all trades chronological): write `rpc_get_agent_trade_history(p_agent_id)` returning `(symbol, side, quantity, price, executed_at)`.
- Lines 464-468 (sell pnl backfill in stats fallback): already redundant after rpc_update_agent_stats works — just delete the fallback.
- Lines 477-480 (all agent trade pnl for snapshot): write `rpc_sum_agent_pnl(p_agent_id)` returning numeric.
- Lines 485-494 (portfolio_snapshots upsert): write `rpc_upsert_portfolio_snapshot(p_user_id, p_agent_id, p_value, p_pnl_pct, p_date)`.

**Sonnet prompt:**
```
Read CLAUDE.md.

Migrate every `.from()` call in supabase/functions/run-agents/index.ts to RPCs. This is a CLAUDE.md rule-1 violation.

Write a single migration 026_run_agents_rpcs.sql that adds these RPCs:
  - rpc_get_today_trades_for_agent(p_agent_id uuid) RETURNS TABLE(pnl numeric, side trade_side, symbol text, executed_at timestamptz)
  - rpc_get_agent_trade_history(p_agent_id uuid) RETURNS TABLE(symbol text, side trade_side, quantity numeric, price numeric, executed_at timestamptz)
  - rpc_sum_agent_pnl(p_agent_id uuid) RETURNS numeric
  - rpc_upsert_portfolio_snapshot(p_user_id uuid, p_agent_id uuid, p_value numeric, p_pnl_pct numeric, p_date date) RETURNS void

Then update index.ts:
  - Line 165-169 → use rpc_get_today_trades_for_agent (filter executed_at by today inside the RPC)
  - Line 182-186 → rpc_get_agent_trade_history
  - Line 464-472 → DELETE the entire fallback block (lines 460-473). rpc_update_agent_stats is canonical now.
  - Line 477-480 → rpc_sum_agent_pnl
  - Line 485-494 → rpc_upsert_portfolio_snapshot

Tell user to run 026 in Supabase SQL Editor. Then deploy: supabase functions deploy run-agents --no-verify-jwt
Update CHANGELOG.
```

---

## Suggested ship order

1. **BUG-001** (5-min fix, deploys cleanly, unblocks every metric). Ship first.
2. **BUG-002** (migration 025, no code changes). Ship second. Holdings drops from 39 → 7.
3. **BUG-007** (one-line fix, big behavioral impact). Ship third.
4. **BUG-003 bundle** (tweaks four constants + one qty math line). Ship fourth.
5. **BUG-004**, **BUG-005**, **BUG-008** in any order.
6. **BUG-009** last — it's the most invasive but lowest urgency.

After 1+2+3+4 ship, re-trigger the Force Run and compare:
- agent_logs should have `action='traded'` rows
- Holdings should show ~7-12 positions (real longs + new buys post-Bug 4)
- Skip reasons should drop dramatically

---

## Things that ARE working (don't re-investigate)

- ✅ Sell P&L records correctly (migration 023 verified)
- ✅ Edge function v38 deployed today, includes sell-cost lookup + closeAllShorts
- ✅ Cron is healthy (`*/15 14-20 * * 1-5`)
- ✅ Alpaca shorts are flat (closeAllShorts had nothing to do)
- ✅ Strategy Lab bootstrap fires (Evo Bot made its first trade ever)
- ✅ Web useNativeDriver warnings fixed (a3c2b9f)
- ✅ Privacy mode, S&P legend, deploy name dedup, social feed, follow-own-agents all fixed today (8fdac05)
