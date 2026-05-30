-- ─────────────────────────────────────────────────────────────────────────────
-- 026_agent_can_short.sql
-- Opt-in per-agent short selling. CLAUDE.md rule 8 (changed 2026-05-30):
-- short selling is OPT-IN via agents.can_short, default FALSE (long-only).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the flag. Existing agents default to FALSE → unchanged long-only behavior.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS can_short boolean NOT NULL DEFAULT false;

-- 2. Recreate rpc_create_agent with a new p_can_short param.
--    The old 9-arg signature is dropped first: appending a DEFAULTed 10th arg
--    would otherwise leave an ambiguous overload for 9-arg calls.
DROP FUNCTION IF EXISTS rpc_create_agent(uuid, text, text, text, text, jsonb, numeric, boolean, text);

CREATE OR REPLACE FUNCTION rpc_create_agent(
  p_user_id uuid,
  p_name text,
  p_strategy text,
  p_description text,
  p_mode text,
  p_config jsonb,
  p_budget numeric,
  p_is_private boolean,
  p_model_id text,
  p_can_short boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  INSERT INTO agents (
    user_id, name, strategy, description, status, mode, config,
    budget, is_private, model_id, can_short, pnl, pnl_pct, trades_count,
    win_rate, max_drawdown, sharpe_ratio
  ) VALUES (
    p_user_id, p_name, p_strategy, p_description, 'active'::agent_status, p_mode::agent_mode, p_config,
    p_budget, p_is_private, p_model_id, p_can_short, 0, 0, 0, 0, 0, 0
  )
  RETURNING row_to_json(agents.*) INTO v_result;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_create_agent(uuid, text, text, text, text, jsonb, numeric, boolean, text, boolean) TO anon, authenticated;
