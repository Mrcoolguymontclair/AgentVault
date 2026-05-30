# AgentVault — Issue Backlog (audited)

**Audited by Opus (Planner) on 2026-05-30** against **live DB state** (project `aktzwattqlpadvnaglit`) + current `main`, not just migration-file history. Each item carries a verified `STATUS`.

> **Hard rule carried from the brief:** cleanup ≠ risk controls. The DO-NOT-TOUCH list (exits −7%/+12%/10d, `MAX_OPEN_POSITIONS=3`, `MAX_POSITION_PCT=0.25`, `DAILY_ENTRY_LIMIT=5`, `DAILY_LOSS_LIMIT_PCT=0.03`, `MIN_PRICE=20`, `MIN_AVG_VOLUME=1e6`, `AI_CONFIDENCE_FLOOR=0.60`) must not be removed or re-valued in any cleanup PR.
>
> **Bootstrapping note on acceptance tests:** the "replay historical bars through `runStrategy`+`managePositions` → identical trades" test *is* ISSUE-15. It doesn't exist yet. That's why ISSUE-09→15 go first: they are the prerequisite for every other cleanup item's behavior-preserving proof.

## Status summary

| # | Title | Type | Pri | STATUS |
|---|---|---|---|---|
| 15 | Backtest/measurement harness | feature | **P0** | confirmed (absent) |
| 09 | Triplicated feed fallback → shared helper | cleanup | P1 | confirmed |
| 01 | `rpc_export_trades` bad columns | bug | P1 | confirmed |
| 02 | `rpc_generate_portfolio_report` bad columns | bug | P1 | needs-investigation (fn absent from live DB) |
| 03 | Portfolio value defined 3 ways | bug | P1 | confirmed |
| 04 | Cron sends `force:true` (gate bypassed) | bug | P1 | confirmed (collision already resolved) |
| 05 | `isMarketOpen()` locale-string parse + no holidays | bug | P1 | confirmed |
| 06 | `get-market-bars` no feed fallback | bug | P2 | confirmed |
| 16 | Hardcoded status secret to `anon` | security | P1 | confirmed |
| 17 | API keys plaintext under "encrypted" name | security | P1 | confirmed |
| 13 | Short selling half-state | feature | P1 | in-progress (decision made: finish) |
| 14 | `momentum5d` dropped from custom prompt | clarity | P2 | confirmed |
| 07 | Dead no-op loop in `021` | cleanup | P2 | confirmed (inert) |
| 08 | Duplicate migration numbers | cleanup | P2 | confirmed (4 pairs) |
| 10 | Three overlapping setup scripts | cleanup | P2 | confirmed |
| 11 | `agent_leaderboard` scattered | cleanup | P2 | already-fixed (runtime); files scattered |
| 12 | `rpc_get_portfolio_snapshots` overloads | cleanup | P2 | already-fixed |
| 18 | Risk constants split across 2 files | clarity | P2 | confirmed |
| 19 | Custom prompt truncated at 500 chars | clarity | P2 | confirmed |

---

### ISSUE-15 — No backtest / measurement harness
- TYPE: feature
- PRIORITY: P0 (highest-value item in this doc)
- STATUS: confirmed — no harness exists (only `buildChartFromTrades` chart reconstruction; no strategy replay).
- WHERE: new module; reuses `run-agents/strategies.ts` (`runStrategy`, `managePositions`) + the injectable data helper from ISSUE-09.
- WHAT'S WRONG: No way to replay history and measure a strategy. Tuning is blind — cannot tell skill from a lucky week, or whether a change beats SPY buy-and-hold.
- FIX: Build a replay harness over a date range that feeds historical daily bars through `runStrategy`+`managePositions` and reports total return, Sharpe, max drawdown, win rate, and **delta vs SPY buy-and-hold**. Reuse measurement plumbing from `022`/`024`; `strategy_lab.vs_spy_pct` is a model. Requires ISSUE-09 done first (injectable data layer).
- ACCEPTANCE TEST: On a fixed historical period for one symbol, the harness reproduces hand-checked return/drawdown numbers. Deterministic: same inputs → same trades.
- PR: —

### ISSUE-09 — `sip → iex → null` feed fallback is triplicated
- TYPE: cleanup
- PRIORITY: P1 (prerequisite for ISSUE-06 and ISSUE-15)
- STATUS: confirmed — `iex` fallback count: `get-current-prices`=3, `alpaca.ts`=4, `get-market-bars`=0 (drifted/missing).
- WHERE: `get-current-prices/index.ts`, `run-agents/alpaca.ts` (`getDailyBars`/`getLatestPrice`), `get-market-bars/index.ts` (missing).
- WHAT'S WRONG: The same fallback loop is copy-pasted across functions and has drifted — one place omits it entirely.
- FIX: Extract one shared, **injectable** data helper (`fetchBars(symbol, opts)` / `fetchLatest(symbol)`) used everywhere. Injectable so ISSUE-15 can swap live Alpaca for historical replay.
- ACCEPTANCE TEST: Behavior-preserving — for a set of symbols, `fetchBars`/`fetchLatest` return byte-identical results to the pre-refactor per-call paths (live + mocked iex-only key).
- PR: —

### ISSUE-01 — `rpc_export_trades` references columns that don't exist
- TYPE: bug
- PRIORITY: P1
- STATUS: confirmed — function exists in live DB and its body still references `t.qty` / `t.created_at`.
- WHERE: `migrations/004_subscriptions.sql` → live `rpc_export_trades`.
- WHAT'S WRONG: Selects `t.qty`/`t.created_at`; real columns are `quantity`/`executed_at`. RPC throws at runtime → trade export broken.
- FIX: New migration recreating `rpc_export_trades` using `t.quantity`/`t.executed_at` (alias to `qty`/`created_at` in the JSON if the client expects those keys — check the caller).
- ACCEPTANCE TEST: Call the RPC for a user with trades (e.g. restore a few rows from `archive_reset_20260530.trades` into a test user, or call against historical data) → returns rows, no error.
- PR: —

### ISSUE-02 — `rpc_generate_portfolio_report` references nonexistent `agent_logs` columns
- TYPE: bug
- PRIORITY: P1
- STATUS: needs-investigation — **the function does NOT exist in the live DB** (`pg_proc` count = 0). Migration `020` was apparently never applied (or was dropped). So today the report feature errors with "function does not exist," not the column error. The file bug is real and would surface the moment `020` is applied as-is.
- WHERE: `migrations/020_portfolio_report.sql` (`recent_logs` block).
- WHAT'S WRONG: References `l.created_at`, `l.symbol`, `l.signal_data`. Verified live `agent_logs` columns are `timestamp`, `signal_symbol`, `trade_symbol`, `ai_reasoning`, `skip_reason` — none of the three referenced columns exist.
- FIX: Decide first — is the report feature wanted? If yes: fix the migration to use `l.timestamp`, `l.signal_symbol`, and `ai_reasoning`/`skip_reason` instead of `signal_data`, then apply it. If no: delete `020` from the canonical path.
- ACCEPTANCE TEST: After applying the corrected migration, call the RPC → the logs section populates with real rows.
- PR: —

### ISSUE-03 — Portfolio value computed three contradictory ways
- TYPE: bug
- PRIORITY: P1
- STATUS: confirmed — live `rpc_calculate_portfolio_value` body still contains `10000`; `profiles.balance` default = `10000.00`, `agents.budget` default = `1000`; `index.ts` snapshot uses `budget + cumulativePnl`.
- WHERE: live `rpc_calculate_portfolio_value` (`018`), `run-agents/index.ts` snapshot block, design note in `019_per_agent_budget.sql`.
- WHAT'S WRONG: Three definitions disagree: `10000 + SUM(pnl)` vs `budget + cumulativePnl` vs `019`'s intended `SUM(agent budgets) + SUM(P&L)`.
- FIX: Adopt `019`'s canonical definition (sum of agent budgets + realized P&L) in `rpc_calculate_portfolio_value`, the snapshot writer, and any UI read.
- ACCEPTANCE TEST: For a user with one $1000 agent and known realized P&L, the RPC balance, the snapshot value, and any report all equal `1000 + P&L`.
- PR: —

### ISSUE-04 — Cron sends `force:true`, bypassing the market-open gate
- TYPE: bug
- PRIORITY: P1
- STATUS: confirmed — but note the "two colliding jobs" is **already resolved**: live `cron.job` has exactly one `run-agents-market-hours` (jobid 6, `*/15 14-20 * * 1-5`). Its body is `{"force": true}`, which makes `isMarketOpen()` dead.
- WHERE: live `cron.job` (from `003`/`005`), `run-agents/index.ts` force handling, `market-utils.ts` `isMarketOpen()`.
- WHAT'S WRONG: `force:true` skips `isMarketOpen()`. Today only the cron *schedule* (14–20 UTC weekdays) approximates the gate — no holiday/half-day handling, and any non-cron caller inherits the bypass.
- FIX: Decide the canonical cadence; stop sending `force:true` from cron so `isMarketOpen()` actually gates (pairs with ISSUE-05). Keep `force` available only for the manual Debug "Force Run."
- ACCEPTANCE TEST: `SELECT * FROM cron.job WHERE jobname='run-agents-market-hours'` → exactly one row, body no longer forces; a tick on a market holiday logs "market closed" and places no trades.
- PR: —

### ISSUE-05 — `isMarketOpen()` parses a locale string back into a Date
- TYPE: bug
- PRIORITY: P1 (pairs with ISSUE-04 — only matters once `force:true` is removed)
- STATUS: confirmed — verified body re-parses `now.toLocaleString("en-US",{timeZone:"America/New_York"})` into `new Date()` then reads `getDay()/getHours()`; no holiday handling.
- WHERE: `run-agents/market-utils.ts`.
- WHAT'S WRONG: Re-parsing a formatted string is host/locale-dependent and read in server-local time, not ET → wrong decisions around midnight/DST. No market-holiday/half-day check → wasted runs + AI tokens.
- FIX: Compute ET parts via `Intl.DateTimeFormat(..,{timeZone:'America/New_York',..}).formatToParts`. Add a holiday/half-day table.
- ACCEPTANCE TEST: Unit tests across a DST boundary and a known holiday (e.g. 2026 July 4 observed) return the correct open/closed.
- PR: —

### ISSUE-06 — `get-market-bars` has no feed fallback
- TYPE: bug
- PRIORITY: P2 (do as part of ISSUE-09)
- STATUS: confirmed — `get-market-bars/index.ts:30` hardcodes `feed=sip`; zero `iex` references in the file.
- WHERE: `functions/get-market-bars/index.ts`.
- WHAT'S WRONG: On a free Alpaca key, `sip` fails → SPY benchmark empty → chart/benchmark overlays break.
- FIX: Route through the shared helper from ISSUE-09 (`sip → iex → null`).
- ACCEPTANCE TEST: With an iex-only key, the SPY benchmark still returns bars.
- PR: —

### ISSUE-16 — Hardcoded status-page secret granted to `anon`
- TYPE: security
- PRIORITY: P1
- STATUS: confirmed — live `_status_key_ok` body still contains `agentvault2026`.
- WHERE: `013_status_rpcs.sql` → live `_status_key_ok`; status RPCs granted to `anon`.
- WHAT'S WRONG: A hardcoded password in SQL gates RPCs that expose all trades/logs to anyone who knows the string.
- FIX: Move the secret to edge-function env/config, rotate it, tighten grants off `anon` where possible.
- ACCEPTANCE TEST: The literal `agentvault2026` no longer appears in source/DB; access requires the configured secret.
- PR: —

### ISSUE-17 — API keys stored plaintext under "encrypted" naming
- TYPE: security
- PRIORITY: P1
- STATUS: confirmed — columns `user_api_keys.api_key_encrypted` and `profiles.alpaca_key_secret` both exist; populated/read raw (currently 0 rows, so no live exposure yet — fix before any key is saved).
- WHERE: `017_custom_api_keys.sql`, `004_subscriptions.sql`, `rpc_add_api_key`, `rpc_get_key_for_agent`.
- WHAT'S WRONG: Groq/OpenAI/Anthropic + Alpaca secrets sit plaintext in a column named as if encrypted.
- FIX: Encrypt at rest (Supabase Vault / pgsodium) or store references; rename the column to reflect reality; keep unmasked read service-role-only (already is).
- ACCEPTANCE TEST: Stored values are not human-readable; only the edge function can decrypt and trade.
- PR: —

### ISSUE-13 — Short selling half-state
- TYPE: feature
- PRIORITY: P1
- STATUS: in-progress — **decision already made (2026-05-30): finish shorts** (full strategy logic shipped; migration 026 `can_short`). End-to-end live verification is scheduled for **Mon 2026-06-01 15:00 UTC** (routine `trig_01AF1n6ybA1bbvk4SK2ZcdRe`).
- WHERE: `026_agent_can_short.sql`, `index.ts` (`closeAllShorts`, executor classification), `025_seal_orphan_shorts.sql`, `strategies.ts`/`groq.ts` `canShort` branches.
- WHAT'S WRONG (revised): Not "half-reverted" anymore — it's being finished. Remaining cleanup: `025` seal is a one-time historical fix, now **inert** post-reset (no orphan shorts exist); `closeAllShorts` force-cover is an **intentional** safety for long-only agents, not a crutch to delete.
- FIX: Let Monday's routine confirm entry → cover P&L → exits → holdings on a `can_short` agent. If clean, mark `025` superseded/archived (like ISSUE-07) and keep the long-only `closeAllShorts` guard. If Monday fails, fix the executor.
- ACCEPTANCE TEST: Replay (via ISSUE-15) of a `can_short` agent produces correct short entry + cover P&L; long-only agents are byte-identical with shorts disabled.
- PR: —

### ISSUE-14 — `momentum5d` dropped from the custom-strategy prompt
- TYPE: clarity
- PRIORITY: P2
- STATUS: confirmed (with nuance) — `interpretCustomStrategy` (`groq.ts:147`) builds its market line as `symbol:$price 1d:% RSI: SMA:$` with **no** `momentum5d`. BUT `momentum5d` **is** used elsewhere (`evalMispricing`/mispricing prompt, `groq.ts:427`), so it is NOT dead — do not delete it.
- WHERE: `strategies.ts` `customStrategy` (builds `momentum5d`), `groq.ts` `interpretCustomStrategy` (drops it from the prompt).
- WHAT'S WRONG: The custom-strategy decision model never sees a feature that's computed and passed to it.
- FIX: Add `momentum5d` to `interpretCustomStrategy`'s market line (return-relevant signal). Leave `evalMispricing` as-is.
- ACCEPTANCE TEST: The assembled `interpretCustomStrategy` prompt string contains the `5d_momentum` feature for each symbol; snapshot-test the prompt builder.
- PR: —

### ISSUE-07 — Dead no-op loop in historical backfill
- TYPE: cleanup
- PRIORITY: P2
- STATUS: confirmed — `021_fix_historical_pnl.sql:28-33` has `FOR avg_cost IN (SELECT 1) LOOP EXIT; -- dummy loop ...`. Inert one-time backfill, superseded by `023`.
- WHERE: `migrations/021_fix_historical_pnl.sql`.
- WHAT'S WRONG: Dead inner loop; `021` and `023` both FIFO-recompute the `$0` sell bug — `023` is the canonical, ongoing fix (`rpc_get_agent_avg_cost`+`rpc_insert_trade`, used by `index.ts`).
- FIX: Mark `021` superseded-by-`023` (header comment / move to an `archive/` migrations folder). Do NOT re-run it. Remove the dead loop only if archiving in place.
- ACCEPTANCE TEST: No agent stats change (it's already applied & inert); a fresh-apply path skips it without schema/data diff.
- PR: —

### ISSUE-08 — Duplicate migration numbers
- TYPE: cleanup
- PRIORITY: P2
- STATUS: confirmed — **4** duplicate prefixes (brief listed 3): `001` (`001_initial_schema` + `001_rpc_bypass_functions`), `003` (`cron_setup`+`notifications`), `004` (`agent_follows`+`subscriptions`), `005` (`cron_setup`+`feed_policies`).
- WHERE: `supabase/migrations/`.
- WHAT'S WRONG: Ambiguous apply-order across four numeric collisions.
- FIX: Renumber to a strict linear sequence (or timestamped names); document canonical order in a README. Coordinate with `supabase_migrations.schema_migrations` so already-applied versions aren't re-run.
- ACCEPTANCE TEST: A fresh apply on a blank project runs start-to-finish with no error and yields a schema identical to production (`pg_dump --schema-only` diff = empty).
- PR: —

### ISSUE-10 — Three overlapping "full setup" scripts
- TYPE: cleanup
- PRIORITY: P2
- STATUS: confirmed — `000_run_this_first_in_sql_editor.sql`, `001_initial_schema.sql`, `FULL_SETUP.sql` all present with overlapping/divergent schema.
- WHERE: those three files.
- WHAT'S WRONG: A new contributor can't tell which to run; `001` lacks `config/budget/is_private/model_id` on `agents` (added in `002`); `000`/`FULL_SETUP` inline them.
- FIX: Choose one canonical bootstrap; mark the others historical (archive) or delete.
- ACCEPTANCE TEST: Canonical path on a blank project yields the same schema as production (`pg_dump --schema-only` diff = empty).
- PR: —

### ISSUE-11 — `agent_leaderboard` view scattered across files
- TYPE: cleanup
- PRIORITY: P2
- STATUS: already-fixed (runtime) — live DB has exactly one `agent_leaderboard` view (the `022` definition). Only the *source files* still scatter four definitions.
- WHERE: `000`, `004_agent_follows.sql`, `FULL_SETUP.sql`, `022_bug_fixes.sql`.
- WHAT'S WRONG: File-hygiene only — stale earlier definitions in the setup files; not a runtime bug.
- FIX: Keep `022` as the single source; remove the stale earlier `CREATE VIEW agent_leaderboard` blocks from the canonical setup files (folds into ISSUE-10).
- ACCEPTANCE TEST: After a fresh apply, the view definition matches `022` exactly (`pg_get_viewdef` diff = empty).
- PR: —

### ISSUE-12 — `rpc_get_portfolio_snapshots` competing signatures
- TYPE: cleanup
- PRIORITY: P2
- STATUS: already-fixed — live DB has exactly **1** overload: `(p_user_id uuid, p_since text)`. `014` already dropped the `(uuid,date)` form. No action needed beyond ensuring the canonical setup files don't reintroduce `(uuid,date)`.
- WHERE: `000`/`FULL_SETUP` (stale `(uuid,date)`), `014_order_tracking.sql` (canonical `(uuid,text)`).
- WHAT'S WRONG: Nothing at runtime; only the setup files still contain the stale signature.
- FIX: Remove the `(uuid,date)` definition from the canonical setup files (folds into ISSUE-10). Verify-only otherwise.
- ACCEPTANCE TEST: `\df rpc_get_portfolio_snapshots` shows exactly one signature after a fresh apply.
- PR: —

### ISSUE-18 — Risk constants split across two files
- TYPE: clarity
- PRIORITY: P2
- STATUS: confirmed — `strategies.ts:71-75` (`MIN_PRICE`, `MIN_AVG_VOLUME`, `MAX_OPEN_POSITIONS`, `MAX_POSITION_PCT`, `AI_CONFIDENCE_FLOOR`) and `index.ts:28-29` (`DAILY_ENTRY_LIMIT`, `DAILY_LOSS_LIMIT_PCT`).
- WHERE: those two files.
- WHAT'S WRONG: Risk params live in two places; `MAX_OPEN_POSITIONS=3` (concurrent) is easy to confuse with `DAILY_ENTRY_LIMIT=5` (buys/day).
- FIX: Centralize into one `run-agents/config.ts` with named, commented constants, imported by both. **Values unchanged** (DO-NOT-TOUCH).
- ACCEPTANCE TEST: Single import site; a grep shows the literals defined once; replay (ISSUE-15) produces identical trades before/after.
- PR: —

### ISSUE-19 — Custom-strategy prompt silently truncated at 500 chars
- TYPE: clarity
- PRIORITY: P2
- STATUS: confirmed — `strategies.ts:889`: `config.strategy_prompt...trim().slice(0, 500)`.
- WHERE: `strategies.ts` `customStrategy`.
- WHAT'S WRONG: Prompts >500 chars lose their back half silently.
- FIX: Either raise the cap (and bump the model `max_tokens` accordingly) or surface a UI validation/warning when a prompt exceeds the limit.
- ACCEPTANCE TEST: A 600-char prompt is either fully used (verify in the assembled prompt) or visibly flagged in the UI.
- PR: —

---

## Proposed order (one PR per item)

Sequencing rationale: build the measuring stick first, then everything else can be proven behavior-preserving against it.

1. **ISSUE-09** — shared injectable data helper. Unblocks 06 + 15.
2. **ISSUE-15** — backtest harness (P0). After this, every cleanup PR gets a real "identical trades" gate.
3. **ISSUE-06** — fold `get-market-bars` into the ISSUE-09 helper (tiny, rides on 09).
4. **ISSUE-01, 03** — broken/contradictory accounting RPCs (confirmed live). 
5. **ISSUE-04 + 05** together — remove cron `force:true` and fix `isMarketOpen()`+holidays in one correctness PR (they're coupled).
6. **ISSUE-16, 17** — security, before any real key is saved or a second user exists.
7. **ISSUE-13** — close out after Monday's verification routine reports (finish shorts; archive the inert `025` seal).
8. **ISSUE-14** — add `momentum5d` to the custom prompt.
9. **ISSUE-07, 08, 10, 11, 12** — migration hygiene as ONE coordinated PR (renumber + pick canonical bootstrap + drop stale view/overload defs + archive 021). 11 & 12 are already runtime-correct, so this PR is file-cleanup + a fresh-apply schema-diff test.
10. **ISSUE-18, 19** — config centralization + prompt cap. Polish.
11. **ISSUE-02** — decide whether the portfolio-report feature is wanted at all before fixing+applying `020` (lowest urgency: the function isn't even live today).

**Held / cross-refs:** ISSUE-13 waits on the Mon 2026-06-01 routine. Risk-control *values* (DO-NOT-TOUCH) change only with ISSUE-15 backtest evidence, never in a cleanup PR.
