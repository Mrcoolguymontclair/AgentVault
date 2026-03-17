-- ─────────────────────────────────────────────────────────────────────────────
-- 006_active_on_deploy.sql
-- Agents now start as 'active' so the cron job picks them up immediately.
-- Also sets any existing 'backtesting' agents to 'active'.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Update the rpc_create_agent function to use 'active' as initial status
CREATE OR REPLACE FUNCTION rpc_create_agent(
  p_user_id uuid,
  p_name text,
  p_strategy text,
  p_description text,
  p_mode text,
  p_config jsonb,
  p_budget numeric,
  p_is_private boolean,
  p_model_id text
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
    budget, is_private, model_id, pnl, pnl_pct, trades_count,
    win_rate, max_drawdown, sharpe_ratio
  ) VALUES (
    p_user_id, p_name, p_strategy, p_description, 'active'::agent_status, p_mode::agent_mode, p_config,
    p_budget, p_is_private, p_model_id, 0, 0, 0, 0, 0, 0
  )
  RETURNING row_to_json(agents.*) INTO v_result;
  RETURN v_result;
END;
$$;

-- 2. Migrate any existing 'backtesting' agents to 'active'
UPDATE agents SET status = 'active', updated_at = now()
WHERE status = 'backtesting';
