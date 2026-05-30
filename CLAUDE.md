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
8. Short selling is OPT-IN per agent via `agents.can_short` (default FALSE). Agents without it are long-only. Shorts usually lose money — default OFF in the hire flow and warn the user. (Changed 2026-05-30; was "all shorts disabled".)
9. Minimum stock price: $20. Minimum volume: 1M shares.
10. Max 3 positions per agent. AI confidence >= 0.70 to execute.
11. TERMINOLOGY: users "hire" an agent, not "deploy" it. All user-facing copy + the create-agent flow use "Hire". ("deploy/deployed capital" = money invested, a different meaning — leave those. `supabase functions deploy` = edge-function deploys — leave those too.)

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

## CURRENT STATE (2026-05-30)
- ACCOUNT RESET: portfolio wiped to a fresh start. 0 agents, 0 trades, 0 holdings.
- Account/login, Alpaca-key slot, subscription, and settings preserved.
- Pre-reset data archived: project files in `archive/reset_2026-05-30/` + full DB schema `archive_reset_20260530`.
- In flight: (a) "deploy"→"hire" rename, (b) opt-in per-agent short selling (`can_short`).
- Migration 025 (orphan-short seal) was APPLIED 2026-05-30 before the reset.
- Supabase project: aktzwattqlpadvnaglit
- Vercel: agentvault-lyart.vercel.app
- GitHub: github.com/Mrcoolguymontclair/AgentVault
