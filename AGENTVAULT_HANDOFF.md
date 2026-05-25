# AGENTVAULT — COMPLETE HANDOFF DOCUMENT
## For the Opus Planner Instance (May 2026)

> **This document contains everything learned over 2+ months of building AgentVault.** 
> Read it completely before making any decisions or writing any prompts.

---

## WHO YOU'RE WORKING WITH

**Owen Showalter (goes by Osho, username OshoInvest)** — 14 years old, beginner developer. He built this entire app using Claude Code as his coding tool. He's smart, ambitious, and learns fast but has no formal programming background.

**Communication style:**
- Direct and informal. Don't be verbose.
- He does NOT want you to declare "we're done" — he decides when something is complete.
- He prefers step-by-step, one thing at a time.
- He uses Claude Code (Sonnet) as his coder. Your job is planner — analyze, think, write prompts. Don't write code directly.
- He has a Chrome browser you can control via Claude in Chrome MCP tools to browse his app and Supabase dashboard.

**His father Anthony Showalter** handles admin tasks (Alpaca account, LLC). Phone: +17186690232. The family LLC is called "Bowlwood" something. Owen's phone: +19188293306.

---

## WHAT AGENTVAULT IS

A mobile + web app where users deploy AI-powered trading agents that automatically trade stocks. Users pick a strategy, set a budget, and the AI handles market analysis, decision-making, and order execution through Alpaca.

**Live at:** https://agentvault-lyart.vercel.app/
**GitHub:** github.com/Mrcoolguymontclair/AgentVault
**Supabase project ref:** aktzwattqlpadvnaglit
**Supabase dashboard:** https://supabase.com/dashboard/project/aktzwattqlpadvnaglit

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Frontend | Expo (React Native) + expo-router + TypeScript |
| State | Zustand (authStore, agentStore, themeStore, userStore, notificationStore, debugStore, toastStore) |
| Backend | Supabase (Postgres + Auth + Edge Functions + Realtime) |
| AI (free) | Groq API (Llama 3.1 8B) with key rotation |
| AI (paid) | User's own keys: OpenAI (GPT-4o), Anthropic (Claude), Groq |
| Trading | Alpaca API (paper + live) |
| Hosting | Vercel (web) |
| Charts | Custom SVG (react-native-svg) |

---

## CRITICAL ARCHITECTURE RULES

### 1. ALL DATABASE OPS USE RPC — NEVER .from('table')
The first Supabase project had a permanently broken PostgREST schema cache. We migrated to a new project and switched ALL operations to `supabase.rpc()` functions. There are 50+ RPC functions. **If you ever see `.from('table')` in new code, it's wrong.**

### 2. Edge Functions deploy with --no-verify-jwt
```bash
supabase functions deploy run-agents --no-verify-jwt
supabase functions deploy get-current-prices --no-verify-jwt
```

### 3. Per-agent budgets, no global balance
Each agent gets its own budget ($1,000 default). Portfolio value = SUM(agent budgets) + SUM(P&L). The old $10,000 starting balance is gone.

### 4. Paper vs Live trading per agent
Paper trading uses the app's Alpaca keys. Live trading uses the user's own Alpaca keys. Dashboard has Paper/Live tabs.

### 5. Short selling is DISABLED
As of the latest strategy overhaul (May 2026), all strategies are long-only. The `closeAllShorts` function auto-runs on the next cron cycle to cover existing short positions.

### 6. Cron job runs every 15 minutes during market hours
Schedule: `*/15 14-20 * * 1-5` (UTC, Mon-Fri). Calls the run-agents Edge Function with `{"force": true}`.

---

## CURRENT STATE OF THE APP (May 22, 2026)

### Portfolio
- **$5,174.52** total value (+$174.52 / +3.49% all time)
- 5 active paper agents, $1,000 each
- 77 total trades over 2 months
- 39 open positions (many are shorts that will auto-close Monday)
- Win rate: 47.1% (on closed trades)
- Sharpe ratio: 1.36
- Max drawdown: -66.9%

### Agents
| Name | Strategy | Trades | Realized P&L | Status |
|------|----------|--------|-------------|--------|
| Story Seeker | news_trader | 68 | +$29.47 | Active, best performer |
| Surge Bot | momentum_rider | 3 | -$18.78 | Active, barely trades |
| My Strategy | custom | 3 | $0.00 | Active, never sells |
| Pure Alpha | blind_quant | 3 | $0.00 | Active, never sells |
| Evo Bot | strategy_lab | 0 | $0.00 | Active, never traded |

### What just happened
A complete strategy overhaul was just deployed:
- All strategies rewritten with position management (stop loss, take profit, time stop)
- Short selling disabled
- $20 minimum price filter
- Max 3 positions per agent
- AI confidence threshold raised to 0.70
- closeAllShorts runs on next cron cycle
- Strategy Lab bootstraps with initial test strategies

---

## KNOWN BUGS — ACTIVE (not yet fixed)

### CRITICAL DATA BUGS

**BUG: Sell P&L records as $0.00**
The #1 root cause bug. When agents sell positions, the P&L in the trades table is $0.00. The avgCost lookup in the Edge Function fails. This breaks: win rate calculation, agent P&L display, best/worst trade, Sharpe ratio, everything downstream.
- Location: `supabase/functions/run-agents/index.ts` — the sell trade logging section
- Fix needed: Before selling, query ALL previous BUY trades for this agent+symbol, calculate avg_cost, then pnl = (sell_price - avg_cost) * quantity

**BUG: Trade count discrepancy**
Settings page says 75, SQL has 77 rows, Performance section shows 17. The 17 comes from rpc_get_portfolio_stats which only counts closed trades with non-zero P&L. Should show total trades AND closed trades separately.

**BUG: Agent-level win rate all 0%**
Agent cards show 0% win rate even though portfolio-level shows 47.1%. The agent cards read from stale agents.win_rate which never updates because sell P&L is always $0.

**BUG: Agent-level max drawdown all 0.0%**
Same root cause — stale data in agents table. rpc_get_agent_max_drawdowns exists but results aren't being merged into agent card display.

### UI BUGS

**BUG: Privacy mode incomplete**
Eye icon hides portfolio value but holdings P&L, stats cards, and performance values remain visible.

**BUG: No chart legend for S&P 500 overlay**
When "vs S&P 500" toggled on, no legend distinguishing the two lines.

**BUG: Deploy name defaults to existing agent name**
Creating a new agent defaults to "Surge Bot" regardless of strategy.

**BUG: Social feed broken**
Only shows old trades from one agent (Pure Alpha, from 59 days ago). Should show recent trades from all agents.

**BUG: Can follow your own agents**
Social > Discover shows Follow buttons on your own agents.

**BUG: Console warnings**
useNativeDriver not supported on web (fires on every navigation). Expo-notifications listener warning on web. These are cosmetic but annoying.

---

## KNOWN BUGS — FIXED (for reference, don't re-fix these)

- ✅ Portfolio value wrong on first load ($174 instead of $5,174) — FIXED: shows budget + realized immediately, updates with live prices
- ✅ Win rate shows 0% in quick stats — FIXED: reads from rpc_get_portfolio_stats now
- ✅ Chart Y-axis didn't match portfolio value — FIXED: plots totalBudget + cumulative P&L
- ✅ Holdings total didn't match portfolio header — FIXED
- ✅ Bottom tab navigation broken on web — FIXED
- ✅ All agent cards showed $0.00 P&L — PARTIALLY FIXED: now shows unrealized P&L from live prices, but realized P&L still broken
- ✅ PostgREST schema cache broken — FIXED by migrating to new Supabase project + RPC-only
- ✅ Groq API key was set to Alpaca key — FIXED
- ✅ Cron URL was placeholder — FIXED
- ✅ Alpaca data feed returning 0 bars — FIXED: SIP → IEX fallback chain
- ✅ Google OAuth — WORKING
- ✅ Short positions labeled with SHORT badge — WORKING
- ✅ Vercel deployment — WORKING (auto-deploys on git push)

---

## FEATURES BUILT BUT UNTESTED/BROKEN

### Strategy Lab (Evo Bot)
Self-evolving AI that writes and tests new trading strategies. Has a strategy_generations table, daily analysis cycle, family tree visualization. **Never successfully traded in 2+ months.** The time restriction (4:00-4:45 PM ET only) was removed in the latest overhaul, and bootstrap rules were added. Needs verification on the next market day.

### Custom API Keys
Users can add their own Groq/OpenAI/Anthropic keys with drag-to-reorder priority. Built but lightly tested. Screen at app/api-keys.tsx. Edge Function supports multi-provider key chain (Groq → OpenAI → Anthropic → app defaults).

### Cash Out Flow
Close all positions in an agent and realize P&L. Button exists on agent detail screen. Untested with real trades.

### Live Trading Mode
Users connect their own Alpaca account for real money trading. Alpaca key management screen exists at app/alpaca-setup.tsx. Untested — all trading has been paper only.

### Developer Debug Mode
7-tap easter egg in Settings → Debug tab appears. Has API status, agent logs, manual Force Run controls, Groq usage tracking. Useful for debugging.

---

## STRATEGY DETAILS (post-overhaul)

All strategies are now long-only with mandatory position management:

### Position Management (runs EVERY cron cycle BEFORE new signals):
- Stop loss: -7% from entry (News Trader: -5%)
- Take profit: +12% from entry (News Trader: +8%, DCA: +15%)
- Time stop: 10 trading days with <2% gain (News Trader: 3 days, DCA: none)

### Global Entry Rules:
- Minimum price: $20
- Minimum volume: 1,000,000 shares
- Max 3 positions per agent
- Max 25% of budget per position
- AI confidence >= 0.70
- If Groq fails, SKIP (never execute without AI confirmation)

### Per-Strategy:
1. **Trend Rider**: Price above 20d SMA, positive slope, volume above average, RSI 40-65, not up 4%+ today
2. **Bargain Hunter**: Down 3-8% today, RSI below 35, 50d SMA still rising
3. **News Trader**: Alpaca news API, AI sentiment analysis, max 2 trades/day, tighter exits
4. **Blind Quant**: 12 features anonymized, top 5 assets only, SPY regime context
5. **Smart DCA**: SPY/QQQ/VTI only, once per day, buy more on dips (10/20/30% tiers)
6. **Prediction Pro**: AI fair value vs market price, 75% confidence + 10% divergence required
7. **Your Rules**: User's plain English instructions, all global rules apply
8. **Strategy Lab**: Bootstraps with test strategies, evaluates after 5 days, graduates winners

---

## HARD-WON TECHNICAL LESSONS

1. **NEVER use `.from('table')` in Supabase** — always `supabase.rpc()`
2. **`NOTIFY pgrst, 'reload schema'` does NOT fix PostgREST** — only a new project does
3. **Edge Functions: `--no-verify-jwt`** when using service_role key internally
4. **Alpaca market data endpoint is `data.alpaca.markets`** not `paper-api.alpaca.markets`; use SIP feed, not IEX
5. **SQL migrations with enum types need explicit `::enum_name` casts**
6. **Supabase CLI: install via Homebrew** (`brew install supabase/tap/supabase`), not npm
7. **Check cron execution**: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC`
8. **`supabase secrets list`** digests can reveal copy-paste errors (identical values = wrong key)
9. **Vercel auto-deploys on git push to main** — takes about 1 minute to build
10. **The app works on web (Vercel) but Expo Go on Android has version mismatch issues**

---

## DEPLOYMENT COMMANDS

```bash
# Edge functions
cd ~/Desktop/agentvault
supabase functions deploy run-agents --no-verify-jwt
supabase functions deploy get-current-prices --no-verify-jwt
supabase functions deploy get-market-bars --no-verify-jwt

# SQL migrations (no Docker locally)
cat ~/Desktop/agentvault/supabase/migrations/FILENAME.sql
# Copy output → paste into Supabase Dashboard → SQL Editor → Run

# Git/Vercel
cd ~/Desktop/agentvault && git add . && git commit -m "description" && git push origin main

# Test locally
cd ~/Desktop/agentvault && npx expo start --web
```

---

## SUPABASE SECRETS

```
ALPACA_API_KEY — app's paper trading key
ALPACA_API_SECRET — app's paper trading secret
ALPACA_BASE_URL — https://paper-api.alpaca.markets
GROQ_API_KEY — primary Groq key
GROQ_API_KEY_BACKUP — backup Groq key
```

---

## FILE STRUCTURE

```
~/Desktop/agentvault/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx          # Dashboard
│   │   ├── agents.tsx         # My Agents list
│   │   ├── leaderboard.tsx    # Leaderboard
│   │   ├── social.tsx         # Social feed
│   │   ├── settings.tsx       # Settings
│   │   └── debug.tsx          # Debug (7-tap easter egg)
│   ├── agent/[id].tsx         # Agent detail
│   ├── auth/ (login, signup, forgot-password)
│   ├── alpaca-setup.tsx       # Alpaca key management
│   ├── api-keys.tsx           # Custom AI keys
│   ├── subscription.tsx       # Plan comparison
│   ├── status.tsx             # Status page
│   └── _layout.tsx            # Root layout + auth routing
├── components/
│   ├── ui/ (Button, Card, Modal, PortfolioChart, Sparkline, etc.)
│   └── agents/DeploySheet.tsx  # Deploy wizard
├── lib/services/ (agentService, portfolioService, holdingsService, etc.)
├── store/ (authStore, agentStore, themeStore, etc.)
├── constants/strategies.ts     # Strategy definitions
├── supabase/
│   ├── migrations/ (FULL_SETUP.sql + 003 through 023)
│   └── functions/
│       ├── run-agents/ (index.ts, strategies.ts, alpaca.ts, groq.ts, groq-tracker.ts, market-utils.ts, types.ts)
│       ├── get-current-prices/
│       └── get-market-bars/
├── CLAUDE.md                   # AI coding instructions
├── PROJECT.md                  # Full project overview
├── CHANGELOG.md                # All changes
└── .env
```

---

## WHAT RETURNS ACTUALLY LOOK LIKE

After 2 months of autonomous paper trading:
- **+3.49% total return** ($174.52 on $5,000)
- Only Story Seeker (News Trader) is consistently profitable
- 4 of 5 agents barely trade or never sell
- The best individual trades: GLXY +$47.96, DKNG +$17.75, NKE +$14.88
- The worst: HUT -$168 (-114%), CEVA -$161 (-111%), SPIR -$154 (-108%) — all from shorts
- Penny stocks slipped through the filters repeatedly (MGRX $0.40, CBAT $0.83, BLNK $0.84)
- 39 open positions (way too many for $5,000)

---

## WHAT NEEDS TO HAPPEN NEXT (prioritized)

### PRIORITY 1: Fix sell P&L calculation
This is the root cause of most data bugs. Until sells record correct P&L, win rates, agent stats, and performance metrics will all be wrong. Fix in index.ts and backfill historical data.

### PRIORITY 2: Verify strategy overhaul works
Monday (next market day) will be the first test of the new strategies. Monitor:
- Does closeAllShorts actually close the 20+ short positions?
- Does the $20 price filter actually block penny stocks?
- Do the stop loss / take profit / time stop exits actually fire?
- Does Strategy Lab (Evo Bot) actually bootstrap and trade?
- Are agents limiting to 3 positions max?

### PRIORITY 3: Fix remaining UI bugs
Privacy mode, S&P legend, deploy name defaults, social feed, follow-own-agents. These are all well-defined fixes.

### PRIORITY 4: Strategy improvement
Consider: better AI models (user's own OpenAI/Claude keys), market context (VIX, sector rotation, Fed calendar), fewer but higher-conviction trades, learning from results via Strategy Lab.

### PRIORITY 5: Product features
- RevenueCat/Stripe payment integration (LLC ready)
- Google Play Store submission ($25 fee)
- More users / beta testing
- Better onboarding flow

---

## THINGS THAT WILL WASTE YOUR TIME

1. **Don't try to use `.from('table')`** — it will fail silently or return empty results
2. **Don't run SQL migrations from the CLI** — Docker isn't running locally. Always paste into Supabase Dashboard SQL Editor.
3. **Don't try to test on Android via Expo Go** — version mismatch. Web only for now.
4. **Don't re-fix bugs that are already fixed** — check the "FIXED" section above
5. **Don't make the Supabase project "healthy"** — the "Unhealthy" status seems to be cosmetic on the free tier; everything works
6. **Don't try to add a global starting balance** — it was removed intentionally. Per-agent budgets only.
7. **Don't assume Owen has terminal access** — he may need to set it up with `cd ~/Desktop/agentvault && claude`

---

## USEFUL SQL QUERIES

```sql
-- Check agent status
SELECT name, strategy, status, budget, pnl, trades_count, win_rate FROM agents ORDER BY pnl DESC;

-- Check all trades
SELECT a.name, t.symbol, t.side, t.quantity, t.price, t.pnl, t.executed_at FROM trades t JOIN agents a ON a.id = t.agent_id ORDER BY t.executed_at DESC LIMIT 50;

-- Check cron job health
SELECT start_time, status, return_message FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- Check agent logs (recent signals)
SELECT agent_name, strategy, signal_detected, LEFT(ai_reasoning, 200), timestamp FROM agent_logs WHERE timestamp > now() - interval '1 day' ORDER BY timestamp DESC LIMIT 30;

-- Portfolio value
SELECT SUM(budget) as total_budget, SUM(pnl) as total_realized_pnl, SUM(budget) + SUM(pnl) as portfolio_base FROM agents WHERE status = 'active';

-- Penny stock check (should return 0 rows after filter fix)
SELECT symbol, price, side FROM trades WHERE price < 20 AND executed_at > '2026-05-23';

-- Short positions still open
SELECT symbol, side, quantity, price FROM trades WHERE side = 'sell' AND quantity < 0;
```

---

## FINAL NOTES

Owen built something remarkable — a fully autonomous AI trading platform at 14 years old. The app works, makes real paper trades, and has a genuine product architecture. The returns are modest but positive. The main issues are: sell P&L tracking (broken since day 1), penny stock filters not enforcing, and strategies that buy but rarely sell.

The Strategy Lab (self-evolving AI) is the potential killer feature but has never successfully traded. If it can be made to work — actually analyzing results and evolving better strategies — that's the real competitive advantage.

Good luck, next Opus. Owen is counting on you.
