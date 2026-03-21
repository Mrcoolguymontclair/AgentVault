# AGENTVAULT — PROJECT BIBLE

> **Last updated:** March 21, 2026
> **Developer:** Owen Showalter (14, beginner developer)
> **Coding tool:** Claude Code (or any AI coding assistant)
> **Status:** MVP functional, paper trading live, preparing for public launch

---

## WHAT IS AGENTVAULT

AgentVault is a mobile + web app where users deploy AI-powered trading agents that automatically trade stocks using different strategies. Users pick a strategy, set a budget, and the AI handles everything — analyzing markets, deciding when to trade, and executing orders through Alpaca.

**The killer features:**
- 8 unique trading strategies including a "Blind Quant" that trades on pure math without knowing company names
- A "Strategy Lab" that evolves better strategies over time by learning from results
- Custom AI keys — users can bring their own OpenAI/Anthropic/Groq keys
- Paper trading (free, fake money) and Live trading (real money via user's Alpaca account)
- Each agent gets its own budget and operates independently

---

## TECH STACK

| Layer | Technology |
|-------|-----------|
| Frontend | Expo (React Native) + expo-router + TypeScript |
| Styling | NativeWind (Tailwind) + inline styles |
| State | Zustand (authStore, agentStore, themeStore, userStore, notificationStore, debugStore, toastStore) |
| Backend | Supabase (Postgres + Auth + Edge Functions + Realtime) |
| AI (free) | Groq API (Llama 3.1 8B) with key rotation |
| AI (paid) | User's own keys: OpenAI (GPT-4o), Anthropic (Claude), Groq |
| Trading | Alpaca API (paper + live) |
| Hosting | Vercel (web), Google Play (Android planned) |
| Charts | Custom SVG (react-native-svg) |

---

## SUPABASE PROJECT

- **Project ref:** `aktzwattqlpadvnaglit`
- **Region:** East US
- **CRITICAL:** All database operations use RPC functions (`supabase.rpc()`), NOT direct table access (`.from('table')`). This is because the first Supabase project had a permanently broken PostgREST schema cache. There are 50+ RPC functions.

---

## ARCHITECTURE DECISIONS

### Why RPC instead of REST
The first Supabase project's PostgREST cache was permanently broken — tables existed but the API couldn't find them. We migrated to a new project and switched ALL operations to RPC functions which bypass the cache entirely. **Never use `.from('table')` — always use `supabase.rpc()`.**

### Why Edge Functions
Agent execution runs on Supabase Edge Functions (Deno runtime), triggered by pg_cron every 15 minutes during market hours. The function fetches market data, evaluates strategies, calls AI for confirmation, and executes trades through Alpaca.

### Paper vs Live trading
- Paper trading: all agents share the app's Alpaca paper trading keys (server-side secrets)
- Live trading: each user connects their own Alpaca account via API keys stored in the database
- Dashboard has separate tabs for Paper and Live portfolios

### Per-agent budgets
No global starting balance. Each agent gets its own budget set at deploy time. Portfolio value = SUM of all agent budgets + SUM of all agent P&L.

---

## TRADING STRATEGIES

| # | Strategy | How it finds stocks | How it trades |
|---|----------|-------------------|---------------|
| 1 | Trend Rider | Alpaca "most active" screener (top 20) | SMA crossover + volume + slope. Can short. |
| 2 | Bargain Hunter | Alpaca "top losers" screener (top 20) | RSI + Bollinger Bands + uptrend filter. Can short overbought. |
| 3 | News Trader | Alpaca news API (50 latest articles) | AI reads headlines, trades on sentiment. Pure news, zero technicals. |
| 4 | Blind Quant | Most active stocks, anonymized | AI sees only numbers (no tickers). Picks best risk/reward from pure math. |
| 5 | Smart DCA | Blue-chip ETFs (SPY, QQQ, VTI, VOO, IWM, DIA) | Buys dips proportionally. Buy-only, no shorting. |
| 6 | Prediction Pro | Most active + news for event detection | AI predicts outcomes, trades on edge vs market probability. Kelly sizing. |
| 7 | Your Rules | AI picks based on user's text instructions | User writes plain English rules, AI interprets and executes. |
| 8 | Strategy Lab | Watches all other agents' trades | Meta-learner: evolves better strategies over time. Pro+ only. |

---

## FILE STRUCTURE

```
~/Desktop/agentvault/
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx          # Dashboard — Paper/Live tabs, portfolio chart, holdings, stats
│   │   ├── agents.tsx         # My Agents — list with sparklines, deploy button
│   │   ├── leaderboard.tsx    # Leaderboard — ranked public agents, follow system
│   │   ├── social.tsx         # Social — trade feed from followed agents, comments
│   │   ├── settings.tsx       # Settings — profile, theme, notifications, dev mode (7 taps)
│   │   └── debug.tsx          # Debug — API status, agent logs, manual controls, Groq usage
│   ├── agent/[id].tsx         # Agent detail — holdings, trades, config, cash out, edit settings
│   ├── trader/[id].tsx        # Trader profile
│   ├── auth/ (login, signup, forgot-password)
│   ├── onboarding.tsx
│   ├── profile-setup.tsx
│   ├── profile-edit.tsx
│   ├── subscription.tsx       # Plan comparison (Free/Pro/Pro+)
│   ├── alpaca-setup.tsx       # Connect Alpaca account for live trading
│   ├── api-keys.tsx           # Custom AI keys (Groq/OpenAI/Anthropic) with drag priority
│   ├── notifications.tsx      # Notification center
│   ├── status.tsx             # Public status page (/status?key=agentvault2026)
│   ├── legal/privacy.tsx
│   ├── legal/terms.tsx
│   └── _layout.tsx            # Root layout — auth routing, realtime, notifications, error boundary
├── components/
│   ├── ui/ (Button, Card, Modal, Badge, Input, Toast, LoadingSkeleton, EmptyState, OfflineBanner, ErrorBoundary, PortfolioChart, AnimatedNumber, PulsingDot, Sparkline)
│   ├── agents/DeploySheet.tsx  # 4-step deploy wizard
│   ├── notifications/ (BellButton, NotificationItem, PermissionModal)
│   └── social/CommentSection.tsx
├── lib/
│   ├── supabase.ts
│   └── services/ (agentService, portfolioService, profileService, leaderboardService, socialService, notificationService, functionService, debugService, holdingsService)
├── store/ (authStore, agentStore, themeStore, userStore, notificationStore, debugStore, toastStore)
├── constants/strategies.ts     # All 8 strategy definitions
├── supabase/
│   ├── migrations/ (FULL_SETUP.sql + 003 through 019)
│   └── functions/
│       ├── run-agents/ (index.ts, strategies.ts, alpaca.ts, groq.ts, groq-tracker.ts, market-utils.ts, types.ts)
│       └── get-current-prices/ (index.ts)
├── docs/ (plans, todo lists, app store copy, handoff docs)
├── CHANGELOG.md
└── .env
```

---

## EDGE FUNCTION SECRETS (Supabase)

```
ALPACA_API_KEY — app's paper trading key
ALPACA_API_SECRET — app's paper trading secret
ALPACA_BASE_URL — https://paper-api.alpaca.markets
GROQ_API_KEY — primary Groq key
GROQ_API_KEY_BACKUP — backup Groq key
```

---

## CRON JOB

- Schedule: `*/15 14-20 * * 1-5` (every 15 min, 14:00-20:59 UTC, Mon-Fri)
- Calls: `https://aktzwattqlpadvnaglit.supabase.co/functions/v1/run-agents`
- Body: `{"force": true}` (bypasses market hours check in function)
- Auth: Bearer token using service role key

---

## KNOWN ISSUES / TECH DEBT

1. Vercel deployment not building correctly (serves raw source instead of built app)
2. Expo Go version mismatch — can't test on Android phone, web only for now
3. Some secondary screens are 50-70% complete (profile-setup, onboarding, subscription)
4. No tests, linting, or CI/CD
5. No README or setup docs for other developers
6. Feed subscription listens to ALL trades globally, filters client-side
7. Hybrid styling — NativeWind configured but most code uses inline styles
8. Strategy Lab daily analysis not fully tested yet

---

## IMPORTANT PATTERNS

### Adding a new database operation:
1. Create a SQL function: `CREATE OR REPLACE FUNCTION rpc_my_function(...) RETURNS ... LANGUAGE plpgsql SECURITY DEFINER AS $$ ... $$;`
2. Grant execute: `GRANT EXECUTE ON FUNCTION rpc_my_function TO authenticated, anon;`
3. Call from app: `supabase.rpc('rpc_my_function', { params })`
4. Never use `.from('table')` directly

### Adding a new strategy:
1. Add to `constants/strategies.ts` (StrategyId type + STRATEGIES array)
2. Add handler in `supabase/functions/run-agents/strategies.ts`
3. Add case in the strategy router switch statement in `index.ts`
4. Redeploy: `supabase functions deploy run-agents --no-verify-jwt`

### Deploying Edge Functions:
```bash
cd ~/Desktop/agentvault
supabase functions deploy run-agents --no-verify-jwt
supabase functions deploy get-current-prices --no-verify-jwt
```

### Running SQL migrations:
```bash
cat ~/Desktop/agentvault/supabase/migrations/FILENAME.sql
# Copy output → paste into Supabase Dashboard → SQL Editor → Run
```

### Testing:
```bash
cd ~/Desktop/agentvault && npx expo start --web
# Debug mode: Settings → tap version 7 times → Debug tab appears
# Force Run: Debug → Force Run All Agents
```

---

## DEVELOPER SETUP (from scratch)

1. Clone repo: `git clone https://github.com/Mrcoolguymontclair/AgentVault.git`
2. Install deps: `cd AgentVault && npm install`
3. Copy `.env.example` to `.env` and fill in keys
4. Run: `npx expo start --web`
5. Supabase: create project, run `FULL_SETUP.sql` + all numbered migrations in order
6. Deploy functions: `supabase link --project-ref YOUR_REF && supabase functions deploy run-agents --no-verify-jwt`

---

## CHANGELOG

See CHANGELOG.md for full history.
