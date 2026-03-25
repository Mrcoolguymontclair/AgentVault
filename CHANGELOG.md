# AGENTVAULT CHANGELOG

All notable changes to this project are documented here. Newest entries at the top.

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
