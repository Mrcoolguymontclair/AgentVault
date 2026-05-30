# AGENTVAULT CHANGELOG

All notable changes to this project are documented here. Newest entries at the top.

---

## [2026-05-30] — refactor(copy): rename agent-creation "Deploy" → "Hire" (CLAUDE.md rule 11)

Full-consistency rename of the launch-an-agent sense of "Deploy" to "Hire" — UI copy, legal text, and code identifiers. Capital-sense ("deployed capital", "Budget Deployed") and edge-function-sense (`supabase functions deploy`, debug "run-agents (deployed)") left untouched.

- **Component rename**: `components/agents/DeploySheet.tsx` → `HireSheet.tsx` (via `git mv`). Export `DeploySheet`→`HireSheet`. Identifiers: `handleDeploy`→`handleHire`, `isDeploying`→`isHiring`, `deployError`→`hireError`, `onDeployed`→`onHired`, `onDeploy`→`onHire`. STEP_LABELS last step, "Deploy Agent" (×2), "Review & Deploy", and the plan-limit/console/comment copy all → Hire wording.
- **agents.tsx**: import + `<HireSheet>` usage, `showDeploy/setShowDeploy`→`showHire/setShowHire`, header "Deploy" button + empty-state "Deploy First Agent"/"haven't deployed" copy.
- **UI strings**: `onboarding.tsx`, `auth/signup.tsx`, `(tabs)/index.tsx` (empty-state + "Deploy Agent" button), `(tabs)/leaderboard.tsx`, `(tabs)/social.tsx`, `notificationStore.ts` ("🚀 Agent Hired!").
- **Legal**: `legal/terms.tsx` + `legal/privacy.tsx` — "deploy AI agents"/"agent deployment" → "hire AI agents"/"agent hiring".
- Verified: `grep -rniE "deploy" app components store` leaves only capital/edge-function senses. `npx tsc --noEmit` → 0 app-code errors (only expected Deno errors in `supabase/functions/`).

---

## [2026-05-30] — fix(data): migration 025 seals orphan short positions (BUG-002)

- `supabase/migrations/025_seal_orphan_shorts.sql`: pairs every (agent_id, symbol) with negative lifetime net quantity (leftover pre-overhaul shorts never covered in the trades table) with a single synthetic `buy` of `ABS(net)` shares at the last sell price, `pnl=0`, `order_status='synthetic-seal'`, executed 1s after the last sell. Set-based net approach (not a chronological walk) so interleaved buy/sell symbols like CCL/USO/LCID aren't over-sealed.
- Then refreshes `rpc_update_agent_stats` for each affected agent.
- Dry-run (rolled back) against live DB on 2026-05-30: inserts **42** synthetic rows across **2** agents, drops negative-net positions from 42 → **0**, leaving **3** real long positions. (Recon's 31/7 estimate was stale — 5 days of trading since.) Reversal: `DELETE FROM trades WHERE order_status='synthetic-seal';`
- Status: APPLIED to production 2026-05-30 via `apply_migration`. Post-state verified: 42 seals inserted, 0 negative-net positions remaining, 3 real longs, total trades 132 → 174.

---

## [2026-05-30] — chore(data): full portfolio reset to fresh start + archive

- Archived all account data before wiping: project files in `archive/reset_2026-05-30/` (`agents.json` ×5, `trades.json`/`trades.csv` ×174, `portfolio_snapshots.json` ×69) plus a lossless server-side copy of every table (incl. 6,989 `agent_logs` + 4,316 `groq_usage`) in Supabase schema `archive_reset_20260530`.
- Wiped from live app (user `eb2e36a9…eec2`): agents (cascades trades, agent_logs, strategy_generations, agent_follows), portfolio_snapshots, groq_usage, comments, follows, notifications. All → 0.
- Preserved: profiles (account), user_api_keys, subscriptions, notification_preferences.
- Reversal if ever needed: restore from `archive_reset_20260530.*` tables.

---

## [2026-05-25] — Fix rpc().catch TypeError killing agent runs

- `index.ts:496`: replaced `.rpc(...).catch(...)` (invalid — Supabase RPC builder has no `.catch`) with `await`+ try/catch. The uncaught `TypeError: supabase.rpc(...).catch is not a function` was aborting every successful trade run before `logExecution(action="traded")` could fire, causing every trade to be logged as an error in `agent_logs`.
- Grepped entire `supabase/functions/run-agents/` folder — no other `.rpc(...).catch(` or `.rpc(...).then(` patterns found.

---

## [2026-05-25] — Housekeeping: track handoff doc + fix web useNativeDriver warnings

- **AGENTVAULT_HANDOFF.md**: added to repo so planner context survives across sessions.
- **OfflineBanner**: `useNativeDriver: Platform.OS !== "web"` (was `true`); added `Platform` import.
- **LoadingSkeleton**: both `useNativeDriver: true` calls in the shimmer loop → `Platform.OS !== "web"`.
- **PermissionModal**: added `if (Platform.OS === "web") return;` at top of animation `useEffect` — component already returns null on web but the effect ran first, producing four console warnings per page load.

---

## [2026-05-25] — UI bug bundle: privacy mode, chart legend, deploy name, social feed, follow-own-agents

- **Privacy mode**: eye-icon toggle now also redacts holdings current value + P&L, StatsGrid money cards (Avg P&L, Best/Worst Trade), and per-agent dollar P&L on agent cards. Non-money values (%, trade counts, symbols) remain visible.
- **Chart legend**: SPY overlay now shows a two-item inline legend ("Portfolio" solid dot / "S&P 500" dashed line) below the chart — only visible when the overlay is active.
- **Deploy name**: name field now defaults to the first suggestion from the selected strategy's `nameSuggestions` that doesn't already exist in the user's agents (deterministic, not random). Falls back to numeric suffix if all suggestions collide.
- **Social feed**: `fetchTradeFeed` now client-sorts results by `executed_at` DESC so the feed shows the most recent trades across all agents, not stale ones.
- **Follow own agents**: `DiscoverAgentCard` now receives `isOwnAgent` prop; own agents show "(yours)" label instead of the Follow button as a defensive check on top of the existing server-side filter.

---

## [2026-05-25] — Fix trade count mismatch (Performance section)

- Migration 024: `rpc_get_portfolio_stats` now returns both `total_trades` (all rows) and `closed_trades` (sells/covers with realized P&L). Win rate, avg P&L, Sharpe, drawdown still compute from closed trades only.
- `PortfolioStats` type: added `closedTrades` field alongside existing `totalTrades`.
- `fetchPortfolioStats`: maps both new columns from the RPC response.
- Performance section "Total Trades" card now shows "77 total / 4 closed" format.
- Run migration 024 in Supabase SQL Editor. No edge function redeploy needed.

---

## [2026-05-25] — Fix closeAllShorts not logging cover trades

- `closeAllShorts` now inserts a trade row via `rpc_insert_trade` and calls `rpc_update_agent_stats` for every successful Alpaca cover. P&L computed as `(short_entry_price - cover_fill_price) * qty`.
- Signature updated to accept `supabase` client as first arg; call site updated.
- Logging failures are non-fatal (errors logged, tick continues).
- Redeploy: `supabase functions deploy run-agents --no-verify-jwt`

---

## [2026-05-25] — Fix sell P&L = $0 (P1 root cause)

- New migration `023_sell_pnl_fix.sql`: adds `rpc_get_agent_avg_cost`, `rpc_insert_trade`, and backfills all historical $0 sell rows via FIFO weighted-avg, then refreshes agent stats
- `supabase/functions/run-agents/index.ts`: sell P&L now sourced from `rpc_get_agent_avg_cost` (SQL single source of truth); falls back to Alpaca `avg_entry_price`; throws loudly instead of writing `pnl=0` when avg cost is unresolvable
- Trade insert replaced with `rpc_insert_trade` — no more `.from("trades")`, no retry dance
- **Run migration 023** in Supabase SQL Editor, then redeploy: `supabase functions deploy run-agents --no-verify-jwt`

---

## [2026-05-23] — COMPLETE STRATEGY OVERHAUL — Long-only + exit engine

After one month live with only News Trader profitable, all 8 strategies were
redesigned around position management instead of entry signals. The system now
runs an **exit engine** on every cron tick *before* any entry evaluation —
stop-loss, take-profit and time-stop are now first-class signals that bypass
the daily-entry-limit and AI confirmation.

### Global rules (apply to every long entry)
- Minimum price **$20** (was $15).
- Minimum 20d average volume **1M shares** (was 500K).
- Max **3** open positions per agent (was 5).
- Max **25%** of budget per position (was 40%).
- AI confidence floor **0.70** (was 0.65) — **no fallbacks**: a Groq failure now skips the trade.
- **All short-selling removed** — every strategy is long-only.

### Exit engine (`managePositions` in `strategies.ts`, runs first in `runAgent`)
- Default thresholds: stop -7%, take-profit +12%, time-stop 10d with <2% gain.
- News Trader override: stop -5%, take-profit +8%, time-stop 3d.
- Smart DCA override: take-profit +15%, no stop, no time-stop.
- Exit signals carry `isExit=true` → bypass daily-entry-limit, 25%/3-position caps and AI confirmation.

### Per-strategy redesigns (`strategies.ts`)
- **Trend Rider (momentum_rider)**: most-actives, price > 20d SMA, positive slope, vol ≥ 1.0× avg, RSI 40-65, NOT up >4% today.
- **Bargain Hunter (mean_reversion)**: top-losers, down 3-8% today (not crashes), RSI < 35, 50d SMA still rising.
- **News Trader (news_trader)**: sentiment threshold raised to 0.5, long-only buys only, tighter exits via the exit engine. Quality filter loosened to $20 / 500K vol (events justify lower volume floors).
- **Blind Quant (blind_quant)**: now sends **12 anonymized features** to Groq (1d/5d/20d returns, vol ratio, RSI, BB position, volatility, SMA slope, 52w-high/low %, ATR) + SPY 1d change as market regime. Pre-filters to top 5 candidates by heuristic score.
- **Smart DCA (dca_plus)**: limited to SPY / QQQ / VTI. Once-per-day-per-symbol gate via `agentLastBuyAt`. Tiered sizing: 3-5% dip → 10% of budget, 5-7% → 20%, 7%+ → 30%. Take-profit +15%, no stop.
- **Prediction Pro (prediction_arb)**: edge ≥ 10% AND confidence ≥ 0.75. Size scales 15% at conf 0.75 → 25% at conf 0.90. Long-only.
- **Your Rules (custom)**: all global rules apply. Long-only signals only.
- **Strategy Lab (strategy_lab)**: 4 PM time gate already removed earlier — bootstrap ruleset rewritten to enforce $20/1M, RSI 40-65, long-only.

### Touched files
- `supabase/functions/run-agents/index.ts` — rewrote `runAgent` to run exit engine first, extracted `executeSignal()`, removed all short-tracking branches, enforced new constants.
- `supabase/functions/run-agents/strategies.ts` — full rewrite. Centralized exit engine via `managePositions`. Long-only signatures.
- `supabase/functions/run-agents/groq.ts` — `confirmTrade` no longer auto-approves on Groq failure (returns execute=false). `blindQuantDecision` accepts 12-feature `AnonAsset` + `spyChange1dPct`, prompt re-written long-only.
- `supabase/functions/run-agents/market-utils.ts` — added `calculateATR`, `distanceFromHighPct`, `distanceFromLowPct`.
- `supabase/functions/run-agents/types.ts` — replaced `isShort` with `isExit` on `TradeSignal`.

### Deployment steps
1. **Redeploy edge function** (required): `supabase functions deploy run-agents --no-verify-jwt`
2. **Close existing short positions immediately**: until the redeploy lands, any pre-existing short positions on Alpaca remain open. Manually flatten them in the Alpaca dashboard, or invoke the edge function with `force=true` to let `managePositions` see them as anomalous (it won't — the new code ignores negative quantities entirely, so manual flatten is required).
3. No DB migration required.

---

## [2026-05-23] — Follow-up Critical Dashboard Fixes (Bugs A–C)

### Bug A — Portfolio value wrong on first load ($174.52 vs $5,174.52)
- Root cause: `loadHoldingsAndStats` ran on `authUser?.id` change only, before `agents` had populated. With `agents = []`, `agentBudgetTotal = 0`, so `setLivePortfolioValue` locked in `0 + realized + unrealized` = realized P&L only.
- Fix: effect now also depends on `agents.length`; `loadHoldingsAndStats` early-returns when no agents are loaded yet (re-fires when they arrive).
- Display: portfolio value now shows `totalBudget + realized` immediately with a "Loading prices…" subtitle, then animates to the final `totalBudget + realized + unrealized` once `get-current-prices` returns. Skeleton only appears when totalBudget is also unknown.

### Bug B — Win Rate quick stat always 0%
- Quick stat read `avgWinRate` (mean of `agent.winRate` rows, which are stale 0% until next trade). The Performance section reads `rpc_get_portfolio_stats`.
- Fix: Win Rate quick stat now reads `stats?.winRate` / `stats?.totalTrades` — same source as the Performance section. Shows "—" until stats load.

### Bug C — Chart Y-axis range wrong ($900–$2,100 vs $5,174 portfolio)
- Root cause: `portfolio_snapshots` has partial per-agent coverage (only updated when an agent trades), so the SUM-per-day undercounts the portfolio.
- Fix: dashboard chart now always uses `buildChartFromTrades(userId, currentValue, days, totalBudget)`. Each point is `totalBudget + cumulative_realized_pnl_at_that_date`. Final point is pinned to live portfolio value.
- `fetchPortfolioSnapshots` import removed from `index.tsx`.

### Deployment steps
- Frontend only — no migration or edge function redeploy required.

---

## [2026-05-22] — 20-Bug Comprehensive Audit Fix

### Critical Data / Calculation (Bugs 1–6)
- **BUG 1 — Portfolio value wrong on first load:** Home now renders a loading skeleton while `livePortfolioValue === null` (avoids flashing stale `totalBudget + totalPnL`)
- **BUG 2 — Agent P&L showing $0.00 except Surge Bot:** New `rpc_get_agent_pnl_summary` returns per-agent open positions; home + agents pages blend realized + live unrealized P&L using `fetchCurrentPrices`
- **BUG 3 — Sell trade P&L still 0:** Edge function now falls back to `alpacaPositions[symbol].avg_entry_price` when local `agentAvgCost` is missing, with error log if both are absent
- **BUG 4 — Win-rate inconsistency:** `rpc_update_agent_stats` now counts only closed sells with `pnl != 0` as the win-rate denominator (single source of truth)
- **BUG 5 — Holdings total doesn't match portfolio:** Holdings subtitle now reads `portfolioValue` directly instead of `totalHoldingsValue`
- **BUG 6 — Trade count discrepancies:** Migration 022 backfills `agents.trades_count` / `win_rate` / `pnl` from the trades table for every agent; all UI now reads from the same source

### Strategy / Trading (Bugs 7–9)
- **BUG 7 — $15 min price filter not working:** Edge function now hard-rejects any symbol with price < $15 before strategy logic runs; `[FILTER] X rejected: ...` log added for visibility
- **BUG 8 — Too many open positions:** Edge function enforces max 5 distinct symbols per agent; new buys on new symbols are skipped when at cap
- **BUG 9 — Strategy Lab (Evo Bot) never traded:** Removed 4:00–4:45 PM ET time gating; added `DEFAULT_BOOTSTRAP_RULES` so the lab trades immediately even before rules graduate

### UI / Display (Bugs 10–17)
- **BUG 10 — Home only shows 3 of 5 agents:** "Paper Agents" → "Your Agents"; section now renders the full `agents` array (no mode filter)
- **BUG 11 — Leaderboard "No trades" for agents with trades:** `agent_leaderboard` view rebuilt with trade_stats CTE computing `trades_count`, `win_rate`, `pnl` from the trades table; leaderboard row condition changed from `win_rate > 0` to `trades_count > 0`
- **BUG 12 — Could follow own agents on Discover:** Discover list now filters `a.user_id !== authUser.id`
- **BUG 13 — Social feed shows trades from 59d ago:** Feed pulls from `followed + top-50 leaderboard` agent IDs so recent trades from any public agent appear
- **BUG 14 — Social feed only showed one agent:** Realtime subscription now listens to `new Set([...followedIds, ...leaderboard.map(a => a.id)])`
- **BUG 15 — Allocation bar incomplete:** Rewritten to sort by `|currentValue|`, show top 10 + "Others (N)" bucket
- **BUG 16 — Agent card sparklines missing data:** New `rpc_get_agent_pnl_history` returns 30-day cumulative P&L per agent; sparkline now rendered inside `AgentCard` on home page
- **BUG 17 — Max DD 0% on all agent cards:** New `rpc_get_agent_max_drawdowns` computes per-agent max DD from cumulative trade P&L vs running peak; surfaced on home + agents pages

### Quick Fixes (Bugs 18–20)
- **BUG 18 — "Active since" hardcoded:** `rpc_get_portfolio_stats` returns `MIN(executed_at)` from user's trades
- **BUG 19 — Best/worst trade ignored buys with $0 pnl:** Both now sourced from the `closed_trades` CTE (sells/covers with `pnl != 0` only)
- **BUG 20 — Sharpe too high vs Max DD:** Sharpe now computed from per-day realized P&L returns over portfolio budget (not snapshot-value noise); requires ≥3 days of returns

### New migrations
- `supabase/migrations/022_bug_fixes.sql` — fixes Bugs 2, 4, 6, 11, 17, 18, 19, 20 + new RPCs for client-side blending (Bug 2, 16, 17)

### Deployment steps
1. Run `supabase/migrations/022_bug_fixes.sql` in the Supabase SQL Editor
2. Redeploy edge function: `supabase functions deploy run-agents --no-verify-jwt`

---

## [2026-03-25] — 27-Bug Audit Fix (Critical → Medium)

### Critical
- **BUG 9 / BUG 26 — Tab nav & notification listener on web:** `addNotificationResponseReceivedListener` now wrapped in `Platform.OS !== "web"` guard; tab names added to `inTabs` check in AuthRouter so web routing doesn't redirect away from tabs
- **BUG 3 — All-time P&L always $0:** Fixed: `allTimePnl = portfolioValue - totalBudget` (was incorrectly using `totalPnL` from stale DB agent rows)
- **BUG 4 — Agent cards show $0 (historical P&L):** New migration `021_fix_historical_pnl.sql` recalculates realized P&L for all sell trades that were zeroed by the old `?? fillPrice` bug, then refreshes agent stats

### High
- **BUG 5 — Recent activity shows +$0.00 for buys:** Buy trades now show trade cost (gray); sell trades show P&L in green/red — applies to both dashboard activity and agent detail trade history
- **BUG 7 — Chart Y-axis doesn't match portfolio:** `buildChartFromTrades` now accepts `baseValue` (total agent budget) instead of hardcoded $10,000; chart starts at actual investment amount
- **BUG 8 — Trade history P&L shows "—" for buys:** Agent detail TradeRow now shows cost paid for buys, P&L for sells, with separate "Cost" / "P&L" labels
- **BUG 10 — Timeframe buttons don't refresh chart:** Fixed `useEffect([timeframe])` to use `fromCache=false` so switching timeframes always fetches fresh data
- **BUG 11 — Leaderboard empty with ≤3 public agents:** FlatList now shows `filteredEntries` when podium isn't full (was showing empty `rest` array)

### Medium
- **BUG 13 — Privacy mode incomplete:** Eye icon now masks all financial values: all-time P&L badge, Today's P&L quick stat, holdings subtitle, and activity trade amounts
- **BUG 14 — Win rate shows "—" for 0%:** Now shows "0.0%" when trades exist but none won; "—" only when no trades at all
- **BUG 16 — X-axis date truncated:** Added 4px right padding to PortfolioChart; also fixed `useNativeDriver: true` crash on web in chart animation
- **BUG 17 — Allocation bar breaks for short positions:** `totalHoldingsValue` and allocation percentages now use `Math.abs(currentValue)` so short positions display correctly

### Low / Console
- **BUG 19 — Homepage shows only 3 of 5 agents:** Removed `.slice(0, 3)` — all agents now shown
- **BUG 23 — Deploy name always "Surge Bot":** Names are now deduplicated against existing agents: adds " 2", " 3" suffix if name already taken
- **BUG 24 — Private agent label contradictory:** Description now correctly says "Hidden from leaderboard & social feed" when private (not "Visible on leaderboard")
- **BUG 25 — useNativeDriver warning on web:** Spin animation and PortfolioChart animation both use `Platform.OS !== "web"` for `useNativeDriver`
- **BUG 27 — console.log of Supabase URL in production:** Removed from `lib/supabase.ts`

### New Migrations
- `021_fix_historical_pnl.sql` — run in Supabase SQL Editor to recalculate historical trade P&L and refresh agent stats

---

## [2026-03-23] — Fundamental Strategy Fixes (7 Problems)
- **FIX 1 — Quality filter:** All strategies now reject stocks below $15 price OR below 500k avg daily volume BEFORE any signal logic runs. Killed penny stock buys (MGRX, UGRO, etc.)
- **FIX 2 — Stop loss simplified:** Fixed stop-loss is now 8% below ENTRY price (not 20-day high), only activates after 2 hours of holding. No more false triggers on normal intraday volatility.
- **FIX 3 — P&L calculation fixed:** Long sells now correctly compute `(sell_price - avg_buy_price) × qty`. Short covers compute `(short_entry - cover_price) × qty`. Removed wrong `?? fillPrice` fallback that was zeroing all P&L.
- **FIX 4 — AI gate tightened:** Confidence threshold raised from 0.45 → 0.65. If Groq is unavailable (fallback response), trade is SKIPPED — never execute blind.
- **FIX 5 — Daily trade cap:** Maximum 2 trades per agent per day. After 2 executions, agent skips until tomorrow.
- **FIX 6 — News Trader is pure news:** Removed all stop-loss and technical indicator logic from News Trader. It ONLY analyzes headlines → Groq sentiment → trade or skip.
- **FIX 7 — Blind Quant market regime:** SPY daily change now gates Blind Quant. If SPY < -1.5%, new longs blocked. If SPY > +1.5%, new shorts blocked. Covers/closes still allowed.
- No new migrations needed

## [2026-03-23] — Trailing Stop Overhaul (Less Aggressive)
- **Fixed:** Trailing stop now triggers 5% below ENTRY PRICE, not 3% below 20-day high — the old logic triggered on normal intraday swing, not real losses
- **Fixed:** Trailing stop now enforces a minimum hold time: 1 hour (4 cron cycles) for all equity strategies before checking stops — gives positions room to breathe
- **Fixed:** Smart DCA trailing stop is 10% below entry, checked only after 24 hours — appropriate for long-term ETF positions
- **Improved:** Trailing stop logs now clearly show: symbol, hold time, entry price, current price, stop price, and SAFE/TRIGGERED/TOO EARLY status
- **Improved:** Trades query now ordered by `executed_at ASC` to correctly track when each position was first opened
- No new migrations needed

---

## [2026-03-21] — Per-Agent Budgets + Paper/Live Architecture
- **BREAKING:** Removed global $10,000 starting balance. Each agent now has its own independent budget.
- Added Paper vs Live mode per agent (chosen at deploy time)
- Live trading requires user's own Alpaca API keys
- Dashboard now has two tabs: "Live" (red accent) and "Paper" (blue accent)
- Added Cash Out flow: close all positions, show realized P&L, reinvest or withdraw
- Added editable agent settings (name, budget, aggressiveness, time horizon) after deployment
- Strategy type change requires pausing agent and closing positions first
- Budget enforcement: checks Alpaca buying power before live trades
- Rebuilt alpaca-setup.tsx with test connection and account info display
- Migration: 019_per_agent_budget.sql

## [2026-03-21] — Custom API Keys System
- Users can add their own AI provider keys (Groq, OpenAI, Anthropic)
- Drag-to-reorder priority system — keys tried in order, falls back to app's free Groq
- Multi-provider support: Groq (Llama), OpenAI (GPT-4o), Anthropic (Claude)
- Test Key button verifies key before saving
- Usage tracking per key (tokens used, requests, last error)
- App's free Groq keys always at bottom as fallback
- New screen: app/api-keys.tsx
- Migration: 017_custom_api_keys.sql

## [2026-03-21] — Dashboard UI Improvements
- Fixed portfolio P&L display: now shows real all-time P&L instead of $0.00
- Short positions clearly labeled with red SHORT badge, "shorted @ $X.XX"
- Short P&L calculated correctly (profit when price drops)
- Chart built from actual trade data instead of flat synthetic line
- Y-axis auto-scales to data range with proper formatting
- Performance stats use unrealized P&L from open positions when no closed trades
- Best/worst trade shows actual positions (e.g., USO +$32.13)

## [2026-03-21] — Live Price Updates
- New Edge Function: get-current-prices (fetches latest prices from Alpaca)
- Dashboard auto-refreshes every 30s during market hours, 5min outside
- Refresh button with spinning animation
- Holdings show real-time P&L using current market prices
- Market status indicator: "Live Prices" / "Closing Prices" / "Pre-Market" / "After Hours"
- Portfolio value updates automatically without waiting for trades

## [2026-03-20] — Strategy Lab (Meta-Learning Agent)
- New strategy type: Strategy Lab (🧬, Pro+ only)
- Self-evolving AI that writes and tests new trading strategies
- Generates 3 variant strategies per day, tests each for 5 days on $500 budget
- Graduation criteria: 20+ trades, positive Sharpe, beats SPY
- Kill switch: auto-kills strategies losing >5% in test phase
- Family tree visualization of strategy generations
- Migration: 016_strategy_lab.sql

## [2026-03-20] — Short Selling All Strategies
- Enabled short selling for all strategies except Smart DCA
- Trend Rider: shorts when price far below SMA with negative slope
- Bargain Hunter: shorts when RSI > 80 and above upper Bollinger Band
- News Trader: shorts on strongly negative sentiment
- Blind Quant: AI can suggest shorts based on bearish quant signals
- Prediction Pro: shorts when AI predicts negative outcome
- Your Rules: shorts if user instructions mention shorting
- Holdings correctly display short positions with negative quantity
- Migration: 015_short_position_holdings.sql

## [2026-03-20] — Weekend UI Improvements
- Mini sparkline charts on agent cards in Agents tab
- Agent card tap navigates to agent detail screen
- S&P 500 overlay on portfolio chart (dashed gray line, normalized to %)
- Multi-agent chart view: "Total" vs "By Agent" with colored lines + legend
- Auto-refresh every 60 seconds + reload button in header with spin animation
- Public/private toggle per agent (Pro/Pro+ only)

## [2026-03-20] — FIRST REAL TRADES! 🎉
- **SHORT SMCI** at $20.50 (4 shares) — Momentum X / Trend Rider
- **BUY USO** at $90.20 (1 share) — Number Cruncher / Blind Quant (85% AI confidence!)
- **BUY ANNA** at $7.07 (14 shares)
- Blind Quant made a trade without knowing what company it was buying — pure math

## [2026-03-20] — Groq API Key Fix
- Fixed: GROQ_API_KEY in Supabase secrets was set to Alpaca key by mistake (identical digest)
- Re-set correct Groq keys in Supabase secrets
- Groq now returns real AI responses (85% confidence on Blind Quant trade)
- AI fallback: if Groq fails, execute trade anyway at 50% confidence with "AI unavailable" flag

## [2026-03-20] — Complete Strategy Overhaul
- Removed shared 15-stock watchlist — each strategy finds its own stocks
- Trend Rider: scans Alpaca "most active" stocks
- Bargain Hunter: scans Alpaca "top losers"
- News Trader: fetches 50 latest news articles from Alpaca news API
- Blind Quant: anonymizes most active stocks, AI sees only numbers
- Smart DCA: fixed ETF universe (SPY, QQQ, VTI, VOO, IWM, DIA)
- Prediction Pro: most active + news overlap for event detection
- Your Rules: AI picks from most active based on user instructions
- Renamed strategies: Momentum Rider→Trend Rider, Mean Reversion→Bargain Hunter, DCA+→Smart DCA, Prediction Arbitrage→Prediction Pro, Custom→Your Rules
- Merged duplicate news strategies (old News Sentiment + News Trader → single News Trader)

## [2026-03-20] — Alpaca Data Feed Fix (THE FIX)
- Root cause: IEX feed returns 0 historical bars outside market hours
- Fix: SIP → IEX → default feed fallback chain
- getDailyBars now requests 50 bars with 60-day lookback
- All strategies now receive 25+ bars of real price data

## [2026-03-19] — Smarter Strategies + Developer Debug Mode
- Momentum Rider: volume confirmation (1.5x avg), SMA slope filter, trailing stop, "don't chase" guard
- Mean Reversion: Bollinger Band confirmation, uptrend filter, scale-in at RSI<20, partial profits
- News Sentiment: urgency + surprise detection, 24h cooldown, RSI technical confirmation
- DCA+: proportional sizing on dips, market fear bonus, 10% take-profit
- Prediction Arb: Kelly Criterion sizing, requires 15%+ edge
- Custom: richer market context, step-by-step reasoning, 0.7 confidence threshold
- Expanded watchlist to 15 stocks, correlation guard, 3% daily loss limit
- Developer Debug Mode: 7-tap easter egg in Settings → Debug tab with API status, manual controls, agent logs, raw data viewer
- Migration: 007_agent_logs.sql

## [2026-03-19] — Groq Usage Management
- Token tracking per minute/hour/day in groq_usage table
- Rate limiting: waits if approaching 12K tokens/min
- Key rotation: primary → backup on 429, rotates back after 60s
- Conservative mode at 89% daily budget (auto-approves technical signals)
- Efficient prompts: leaner token usage, headline batching, data caching
- Debug dashboard: Groq usage progress bar, estimated remaining runs, 24h chart
- Migration: 008_groq_usage.sql

## [2026-03-19] — More Active Agents
- Lowered signal thresholds globally (AI confidence 0.6 → 0.45)
- Momentum: buys within 1% of SMA, volume bar lowered to 1.2x
- Mean Reversion: RSI buy threshold widened to 40, sell to 60
- Aggressive Mode toggle in deploy config (halves all thresholds)
- 3-strike loosening: after 3 consecutive skips, thresholds loosen 10%
- "Last Signal" timestamp on agent detail screen

## [2026-03-18] — Cron URL Fix (WHY AGENTS WEREN'T TRADING)
- Cron job was calling `YOUR_SUPABASE_PROJECT_ID` placeholder URL — never replaced with real project ref
- Fixed to: `https://aktzwattqlpadvnaglit.supabase.co/functions/v1/run-agents`
- Added `{"force": true}` to cron body to bypass market hours check

## [2026-03-17] — Edge Function CORS + JWT Fix
- Added OPTIONS handler with CORS headers to Edge Function
- Deployed with `--no-verify-jwt` flag
- Run Now button now reaches the Edge Function (was getting 401/CORS errors)

## [2026-03-13] — Strategy Rename + Custom Strategy
- Added "Your Rules" custom strategy: users type plain English trading instructions
- Renamed all strategies to be user-friendly
- Added Time Horizon feature (Fast/Medium/Slow) affecting strategy parameters

## [2026-03-08] — Agent System Activation
- Fixed deploy flow (Supabase RLS was blocking agent creation)
- Agents deploy as "active" by default (was "backtesting")
- Active/Paused toggle on agent detail screen
- Test Run button with force:true for testing outside market hours

## [2026-03-08] — New Supabase Project
- Created fresh project (aktzwattqlpadvnaglit) due to permanently broken PostgREST cache on old project
- Ran FULL_SETUP.sql: all tables, RLS, triggers, views, 31 RPC bypass functions
- Migrated all code to use RPC functions instead of REST

## [2026-03-06 through 2026-03-08] — Initial Build (Phases 1-12)
- Phase 1: Expo project, tabs, dark/light mode, design system, onboarding
- Phase 2: Auth (email/password + Google OAuth), profile setup
- Phase 3: Database schema, RLS, triggers, materialized views
- Phase 4: Dashboard with portfolio chart, agent cards, stats
- Phase 5: Agent marketplace, 5 strategies, deploy wizard
- Phase 6: Execution engine (Edge Function + Alpaca + Groq)
- Phase 7: Leaderboard with rankings, follows, trending
- Phase 8: Social feed, comments, trader profiles
- Phase 9: Push notifications, notification center, preferences
- Phase 10: Settings, subscription tiers, profile editing
- Phase 11: Polish pass
- Phase 12: Legal pages (privacy policy, terms of service)
