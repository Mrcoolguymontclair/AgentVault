# Strategy Lab 2 Plan

> Project: AgentVault  
> Date: 2026-03-27  
> Context: Upgrade the existing `Strategy Lab` from a light daily meta-analysis feature into a real, sandboxed autonomous strategy research system.

## One-Sentence Goal

Build an **offline, sandboxed, autoresearch-inspired strategy evolution engine** that can generate, test, rank, and graduate new trading rule variants without ever directly mutating production trade execution code.

## Why This Exists

Strategy Lab already exists in AgentVault, but today it is still pretty thin:

- it runs only once per day near market close
- it stores `strategy_generations` in the database
- it can reuse `best_rules` through the existing `customStrategy` path
- but it is **not yet a true research harness**

Right now, Strategy Lab behaves more like:

"take the current best rules and run them"

What we want is:

"continuously generate candidate rule sets, test them in a controlled environment, kill weak ones fast, graduate strong ones carefully, and only then expose them to live or paper trading"

## Current State Summary

Based on the repo today:

- `strategy_lab` exists as a strategy type in [constants/strategies.ts](/Users/santhonys/Projects/Owen/agent-trader/constants/strategies.ts)
- the `strategy_generations` table already exists in [016_strategy_lab.sql](/Users/santhonys/Projects/Owen/agent-trader/supabase/migrations/016_strategy_lab.sql)
- the edge function route in [strategies.ts](/Users/santhonys/Projects/Owen/agent-trader/supabase/functions/run-agents/strategies.ts) mainly checks whether there are `best_rules`, then routes execution through `customStrategy`
- the app UI already has Strategy Lab sections in [app/agent/[id].tsx](/Users/santhonys/Projects/Owen/agent-trader/app/agent/[id].tsx)

So the good news is:

- the product concept exists
- the data model exists in seed form
- the UI affordance exists
- the execution hook exists

The missing piece is the **research engine**.

## Core Principles

Strategy Lab 2 should follow these principles:

### 1. Research and production must be separate

The system that invents strategy variants must not directly edit or deploy production execution code.

Instead:

- production trading code stays stable and reviewable
- Strategy Lab only emits structured strategy specs and parameter sets
- production execution consumes only approved specs

### 2. The search space must be constrained

Do not let the AI invent arbitrary code or free-form trading logic with unlimited complexity.

Instead, give it a bounded grammar such as:

- universe selection
- entry conditions
- exit conditions
- risk filters
- sizing rule
- cooldowns
- hold limits

This will make testing safer, faster, and easier to understand.

### 3. Evaluation must be stricter than generation

Generating ideas should be cheap.

Graduating ideas should be hard.

The system should prefer:

- many low-cost candidate variants
- few serious promotions
- very few live deployments

### 4. One metric is not enough

Unlike `autoresearch`, trading cannot be safely optimized on one number like Sharpe.

Strategy Lab 2 should use a scorecard, not a single winner metric.

### 5. Human-readable reasoning matters

Every generated strategy must include:

- the rule text
- the mutation rationale
- what changed vs parent
- why the lab thinks the change might help

This is important for trust, debugging, and future manual review.

## Non-Goals

Strategy Lab 2 should **not**:

- rewrite TypeScript or Deno trading logic directly
- deploy self-modifying code to Edge Functions
- optimize purely on backtest Sharpe
- use live user capital as the first validation layer
- create black-box prompts that no one can audit later

## Product Vision

The end state should feel like this:

1. A user deploys a Strategy Lab agent.
2. The lab creates several candidate variants from a safe template language.
3. Those variants are backtested and paper-evaluated offline.
4. Weak variants are killed automatically.
5. Strong variants are promoted into a small paper-trading tournament.
6. The best paper performers become "graduated" strategies.
7. The user sees a family tree of mutations, performance metrics, and reasons.
8. Only graduated variants can influence live execution.

## Proposed Architecture

## A. Two-Layer System

### Layer 1: Research Sandbox

A separate environment that:

- creates candidate strategies
- backtests them
- scores them
- logs lineage
- promotes or kills them

This can live as:

- a separate service
- a separate repo
- or a clearly isolated subproject inside this repo

Best option: a separate subproject or service, because it lowers the chance of accidental coupling to production trading code.

### Layer 2: Production Runtime

The existing AgentVault runtime keeps doing what it does best:

- scheduled execution
- market data fetch
- broker integration
- portfolio state management
- app UI and notifications

Production runtime should only consume:

- approved strategy specs
- approved parameters
- approved risk caps

Not raw AI-generated code.

## B. Strategy Spec Instead of Free-Form Code

Each generation should be stored as a structured spec, not just plain English.

Example shape:

```json
{
  "universe": {
    "source": "most_active",
    "limit": 20,
    "min_price": 15,
    "min_avg_volume": 500000
  },
  "entry": [
    { "indicator": "rsi14", "op": "<", "value": 30 },
    { "indicator": "price_vs_sma200", "op": ">", "value": 1.0 }
  ],
  "exit": [
    { "indicator": "rsi14", "op": ">", "value": 60 },
    { "type": "max_hold_days", "value": 10 }
  ],
  "risk": {
    "stop_loss_pct": 0.06,
    "take_profit_pct": 0.12,
    "max_positions": 3
  },
  "sizing": {
    "mode": "fixed_fraction",
    "value": 0.1
  }
}
```

The AI can still propose rules in plain English, but the final thing we test and run should be compiled into a structured spec.

## C. Mutation Engine

The mutation engine should not start from scratch every time.

It should mutate from:

- parent strategy specs
- existing top performers
- known baseline templates

Mutation types:

- threshold changes
- indicator swaps
- adding or removing a filter
- changing hold time
- changing stop/take-profit logic
- changing universe constraints
- changing sizing rules

Examples:

- RSI buy threshold `30 -> 27`
- add `price > SMA200` filter
- reduce max hold from `10 -> 5` days
- switch from fixed position size to volatility-adjusted size

This is much safer than "invent any strategy you want."

## D. Evaluation Pipeline

Each candidate should move through 4 stages.

### Stage 1: Structural validation

Reject strategies that are malformed, contradictory, or unexecutable.

Checks:

- valid universe
- valid indicators
- no impossible rules
- no unsupported fields
- no zero-trade setups if trivially detectable

### Stage 2: Historical backtest

Run a realistic backtest with:

- transaction costs
- slippage
- trading calendar
- no lookahead leakage
- walk-forward or split validation

Metrics:

- return
- Sharpe
- Sortino
- max drawdown
- win rate
- profit factor
- turnover
- average hold time
- trade count
- vs SPY or benchmark

### Stage 3: Robustness checks

This is where most bad strategies should die.

Checks:

- multiple train/test windows
- different market regimes
- parameter stability
- sensitivity to modest slippage changes
- minimum trade count
- no reliance on 1 or 2 lucky trades

### Stage 4: Paper tournament

Only the strongest variants reach live paper trading.

Here they run side-by-side in small budget sleeves against:

- parent strategy
- current best generation
- benchmark baseline

This stage tests whether the backtest survives contact with real-time data timing and execution constraints.

## E. Promotion Logic

Promotion should be conservative.

A strategy graduates only if:

- it beats its parent on a composite score
- it passes robustness gates
- it clears a minimum sample size
- it survives paper testing for a minimum time window

Possible states:

- `draft`
- `queued`
- `backtesting`
- `rejected`
- `paper_testing`
- `graduated`
- `retired`

The current `testing / graduated / killed` states are a good seed, but v2 likely needs more lifecycle detail.

## Scoring Model

Do not optimize for a single metric.

Use a weighted scorecard.

Example:

```text
score =
  0.30 * normalized_sharpe +
  0.20 * normalized_sortino +
  0.15 * benchmark_outperformance +
  0.15 * drawdown_penalty +
  0.10 * turnover_penalty +
  0.10 * stability_score
```

Hard fail gates before scoring:

- max drawdown above threshold
- fewer than minimum trades
- negative out-of-sample return
- severe instability across windows

This keeps the system from chasing tiny Sharpe improvements that come from fragile, unscalable behavior.

## Suggested Data Model Changes

The current `strategy_generations` table is a strong start, but v2 likely needs more structure.

Add fields like:

- `spec_json jsonb`
- `parent_spec_hash text`
- `score numeric`
- `sortino_ratio numeric`
- `profit_factor numeric`
- `turnover numeric`
- `avg_hold_days numeric`
- `validation_window text`
- `paper_test_started_at timestamptz`
- `paper_test_completed_at timestamptz`
- `promotion_reason text`
- `rejection_reason text`
- `research_notes text`
- `compiled_prompt text`
- `mutation_type text`
- `mutation_delta jsonb`

Also add a separate table for experiment runs:

### `strategy_experiments`

Each run of a strategy on a specific dataset window should be logged separately.

Fields:

- `generation_id`
- `run_type` (`backtest`, `robustness`, `paper_eval`)
- `window_name`
- `started_at`
- `completed_at`
- `metrics_json`
- `logs_json`
- `passed boolean`

This gives the lab an audit trail instead of overwriting a single summary row.

## Runtime Design

## A. Separate Job Types

Strategy Lab 2 needs separate job classes:

- `generate_variants`
- `validate_variants`
- `backtest_variants`
- `run_robustness_checks`
- `promote_to_paper`
- `evaluate_paper`
- `graduate_or_kill`

These should not all happen inside the current market-hours edge function.

Better options:

- scheduled background worker
- Supabase scheduled functions if sufficient
- separate worker service triggered by queue/table

The current `run-agents` function should not become a giant research orchestrator.

## B. Clear Boundary With Production

Production should only read from something like:

- `approved_strategy_specs`

or

- the top graduated generation for a lab agent

Then convert that into existing execution behavior through the same stable router path.

This means the lab writes **data**, while production runs **code**.

## UI Plan

The current Strategy Lab UI already has a warm-up concept. v2 should extend it with:

### 1. Lab Overview

- current best generation
- number of active experiments
- last analysis date
- paper tournament status

### 2. Family Tree

- parent -> child lineage
- promoted vs killed branches
- mutation labels on edges

### 3. Generation Detail

- human-readable rules
- what changed from parent
- metrics summary
- benchmark comparison
- reasons for promotion or kill

### 4. Experiment Log

- each backtest window
- each robustness run
- each paper evaluation

### 5. Safety Banner

Very important.

Users should know:

- this is experimental
- lab output is not guaranteed
- graduated does not mean safe
- live capital should remain capped

## Rollout Plan

## Phase 1: Foundation

- create structured strategy spec format
- add experiment-run table
- add more lifecycle states
- create local/offline evaluator

Deliverable:

- deterministic backtests for bounded strategy specs

## Phase 2: Mutation + ranking

- build mutation engine
- add baseline templates
- add composite scoring
- add kill/promote logic

Deliverable:

- lab can generate and rank variants offline

## Phase 3: Paper tournament

- run top variants in paper-only mode
- compare against parent and benchmark
- add paper graduation logic

Deliverable:

- only paper-proven variants are promotable

## Phase 4: Product integration

- wire graduated specs into app UX
- add family tree and generation views
- expose best generation explanation

Deliverable:

- users can understand what the lab is doing

## Phase 5: Optional agentic layer

Only after the spec language and evaluator are stable:

- let an AI agent propose mutations
- let another agent critique them
- let a third agent summarize the decision

This mirrors the "generate, critique, promote" workflow instead of trusting one agent.

Important:

Do this only after the sandbox exists.

## Key Risks

### 1. Overfitting disguised as intelligence

This is the main danger.

If Strategy Lab starts optimizing too hard against historical data, it will look smart and trade dumb.

### 2. Research latency

Good evaluation takes time. If the system tries to mutate too fast, quality will collapse.

### 3. Product confusion

Users may think "graduated" means "guaranteed winner." Messaging must be careful.

### 4. Production creep

If the lab starts editing execution logic directly, safety and auditability collapse.

### 5. Cost explosion

If every mutation calls LLMs plus large backtests plus paper runs, compute and API costs will grow quickly.

## What We Should Build First

If we want maximum leverage with minimum chaos, the first v2 milestone should be:

**A bounded strategy spec + deterministic evaluator + experiment log table**

That unlocks almost everything else.

Without that, we are still in "AI writes vibes and we hope the best rules are good" territory.

With that, we have the beginnings of a real autonomous research lab.

## Recommended Final Shape

The cleanest mental model for Strategy Lab 2 is:

### Strategy Lab 1

- AI-assisted meta-learning idea
- daily analysis
- best-rules fallback

### Strategy Lab 2

- sandboxed research engine
- structured strategy grammar
- mutation lineage
- realistic evaluation harness
- strict promotion gates
- separate production handoff

That is a meaningful product upgrade and a safer long-term foundation.

## Final Recommendation

Build Strategy Lab 2 as a **research operating system**, not a magical self-editing strategy bot.

The winning architecture is:

- AI proposes
- evaluator tests
- gates decide
- production consumes approved specs only

That keeps the creativity of autonomous research while preserving the safety and reliability a real trading product needs.
