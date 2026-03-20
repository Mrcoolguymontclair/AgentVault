# AgentVault

AI-powered trading agent platform built with Expo/React Native.

## Stack
- **Frontend**: Expo Router + React Native + TypeScript
- **Styling**: NativeWind (Tailwind for RN) — most code uses inline `style={{}}` objects
- **State**: Zustand stores in `store/`
- **Backend**: Supabase (Postgres + Auth + Realtime + Edge Functions)
- **AI**: Groq LLMs for trade confirmation
- **Broker**: Alpaca paper trading API
- **Notifications**: Expo Notifications

## Project Structure
- `app/` — Expo Router pages (tabs, auth, deep routes)
- `components/` — Reusable UI components
- `store/` — Zustand state stores
- `lib/services/` — Service layer wrapping Supabase RPCs
- `lib/supabase.ts` — Supabase client singleton
- `constants/` — Strategy definitions, model configs, theme colors
- `supabase/functions/run-agents/` — Deno edge function for agent execution
- `supabase/migrations/` — SQL migration files

## Key Patterns
- All DB access goes through `supabase.rpc()` calls — no direct table queries from the client
- Agent execution flow: market hours check → fetch agents → run strategies → AI confirmation → Alpaca order → log results
- Auth flow: login → profile setup → onboarding → main tabs
- Stores use optimistic updates with rollback on failure

## Environment Variables
See `.env.example` for required variables. Edge function secrets are set via the Supabase dashboard.

## Commands
```bash
npm start          # Start Expo dev server
npm run ios        # Start on iOS
npm run android    # Start on Android
npm run web        # Start on web
npm run lint       # Run ESLint
npm run format     # Run Prettier
npm run typecheck  # Run TypeScript type checking
```
