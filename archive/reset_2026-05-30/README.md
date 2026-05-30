# Portfolio Archive — Reset of 2026-05-30

Snapshot of Owen's AgentVault account taken just before a full portfolio reset
(fresh start). Account, Alpaca keys, subscription, and settings were kept; all
bots/trades/holdings/social data below were wiped from the live app.

## Files here (the look-back data)
- `agents.json` — 5 agents at reset time (Evo Bot, My Strategy, Pure Alpha, Story Seeker, Surge Bot)
- `trades.json` — all 174 trades (incl. the 42 migration-025 `synthetic-seal` rows)
- `trades.csv` — same trades, readable: executed_at, agent, symbol, side, quantity, price, pnl, order_status
- `portfolio_snapshots.json` — 69 daily portfolio value snapshots

## Full backup (everything, incl. bulk telemetry)
A lossless server-side copy of ALL tables lives in the Supabase schema
**`archive_reset_20260530`** (project `aktzwattqlpadvnaglit`), including the
6,989 `agent_logs` and 4,316 `groq_usage` rows not exported to flat files here.
Download any of them as CSV from the Supabase SQL editor, e.g.:
`SELECT * FROM archive_reset_20260530.agent_logs;` → Download CSV.

## Account user_id
`eb2e36a9-2c19-4b45-87c2-74889d7eeec2`
