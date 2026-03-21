# AgentVault — AI Coding Assistant Instructions

## CRITICAL RULES
- ALWAYS use supabase.rpc() for database operations. NEVER use .from('table'). The PostgREST cache is broken.
- Read PROJECT.md for full architecture overview before making changes.
- After EVERY change session, update CHANGELOG.md with what was changed, added, or fixed. Format: ## [DATE] — Title, then bullet points.
- After creating new SQL migrations, remind the user to run them in Supabase SQL Editor.
- After changing Edge Functions, remind the user to redeploy: supabase functions deploy run-agents --no-verify-jwt
- Edge Functions use Deno runtime, not Node.js. TypeScript errors about 'Deno' are expected false positives.
- The app targets web + Android. Test on web with: npx expo start --web
- Dark mode is the primary theme. Always test both dark and light mode.

## PROJECT OVERVIEW
See PROJECT.md for full details. Key points:
- Expo React Native app with Supabase backend
- 8 AI trading strategies using Groq/OpenAI/Anthropic
- Paper trading (free) + Live trading (user's Alpaca account)
- Per-agent budgets, no global balance
- Strategy Lab: self-evolving meta-learning agent

## FILE LOCATIONS
- Strategies: constants/strategies.ts + supabase/functions/run-agents/strategies.ts
- Services: lib/services/*.ts
- Stores: store/*.ts
- Edge Functions: supabase/functions/run-agents/
- Migrations: supabase/migrations/

## CHANGELOG PROTOCOL
After every coding session, append to CHANGELOG.md:

```
## [YYYY-MM-DD] — Short Description
- What was added/changed/fixed
- Any new migrations created
- Any deployment steps needed
```
