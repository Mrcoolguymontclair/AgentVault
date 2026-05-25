# AgentVault — AI Coding Instructions

## ROLES
- **Opus (Planner)**: Analyzes the app, browses the website, checks data, finds bugs, writes prompts. Does NOT write code directly.
- **Sonnet (Coder)**: Executes prompts from Opus. Builds features, fixes bugs, writes code. Always reads this file first.

## CRITICAL RULES
1. ALWAYS use `supabase.rpc()` for database operations. NEVER use `.from('table')`. The PostgREST cache is broken.
2. After EVERY coding session, update CHANGELOG.md with what changed.
3. After creating new SQL migrations, tell the user to run them in Supabase SQL Editor.
4. After changing Edge Functions, tell the user to redeploy: `supabase functions deploy run-agents --no-verify-jwt`
5. Edge Functions use Deno runtime, not Node.js. TypeScript errors about 'Deno' are expected.
6. Test on web: `npx expo start --web`
7. Dark mode is primary. Test both dark and light.
8. All short selling is DISABLED. Long-only trading.
9. Minimum stock price: $20. Minimum volume: 1M shares.
10. Max 3 positions per agent. AI confidence >= 0.70 to execute.

## PROJECT OVERVIEW
See PROJECT.md for full architecture details.

## KEY FILES
- Strategies: `constants/strategies.ts` + `supabase/functions/run-agents/strategies.ts`
- Services: `lib/services/*.ts`
- Stores: `store/*.ts`
- Edge Functions: `supabase/functions/run-agents/`
- Migrations: `supabase/migrations/`
- Dashboard: `app/(tabs)/index.tsx`
- Agent Detail: `app/agent/[id].tsx`

## DEPLOY COMMANDS
```bash
# Edge function
supabase functions deploy run-agents --no-verify-jwt
supabase functions deploy get-current-prices --no-verify-jwt

# Commit and push (triggers Vercel deploy)
git add . && git commit -m "description" && git push origin main

# Test locally
npx expo start --web
```

## CURRENT STATE (May 2026)
- 5 active paper trading agents ($1,000 each)
- +$174.52 (+3.49%) all time return over 2 months
- 77 total trades
- News Trader is most active (68 trades)
- Strategy overhaul just deployed: long-only, position management, higher quality filters
- Supabase project: aktzwattqlpadvnaglit
- Vercel: agentvault-lyart.vercel.app
- GitHub: github.com/Mrcoolguymontclair/AgentVault
