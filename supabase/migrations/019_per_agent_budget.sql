-- 019_per_agent_budget.sql
-- Removes the global $10K starting balance concept.
-- Portfolio value is now: SUM(agent budgets) + SUM(agent P&L).
-- Adds per-user Alpaca key retrieval for live agents,
-- agent settings update RPC, and cash-out support.

-- ─── 1. RPC: Update agent settings (editable while active) ──────────────────

CREATE OR REPLACE FUNCTION rpc_update_agent_settings(
  p_agent_id    uuid,
  p_name        text    DEFAULT NULL,
  p_budget      numeric DEFAULT NULL,
  p_aggressive  boolean DEFAULT NULL,
  p_time_horizon text   DEFAULT NULL,
  p_is_private  boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent   agents%ROWTYPE;
  v_result  json;
BEGIN
  -- Must be the agent owner
  SELECT * INTO v_agent FROM agents WHERE id = p_agent_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found or not owned by user';
  END IF;

  IF p_name IS NOT NULL THEN
    UPDATE agents SET name = p_name WHERE id = p_agent_id;
  END IF;

  IF p_budget IS NOT NULL AND p_budget >= v_agent.budget THEN
    -- Budget can only increase (never decrease below current value)
    UPDATE agents SET budget = p_budget WHERE id = p_agent_id;
  END IF;

  IF p_aggressive IS NOT NULL THEN
    UPDATE agents SET config = jsonb_set(
      COALESCE(config, '{}')::jsonb,
      '{aggressive_mode}',
      CASE WHEN p_aggressive THEN '1'::jsonb ELSE '0'::jsonb END
    ) WHERE id = p_agent_id;
  END IF;

  IF p_time_horizon IS NOT NULL THEN
    UPDATE agents SET config = jsonb_set(
      COALESCE(config, '{}')::jsonb,
      '{time_horizon}',
      to_jsonb(p_time_horizon)
    ) WHERE id = p_agent_id;
  END IF;

  IF p_is_private IS NOT NULL THEN
    UPDATE agents SET is_private = p_is_private WHERE id = p_agent_id;
  END IF;

  UPDATE agents SET updated_at = now() WHERE id = p_agent_id;

  SELECT row_to_json(a.*) INTO v_result FROM agents a WHERE a.id = p_agent_id;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_update_agent_settings(uuid, text, numeric, boolean, text, boolean) TO authenticated;

-- ─── 2. RPC: Get user's Alpaca keys (service_role only — for edge functions) ─

CREATE OR REPLACE FUNCTION rpc_get_user_alpaca_keys(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_key_id     text;
  v_key_secret text;
BEGIN
  SELECT alpaca_key_id, alpaca_key_secret
    INTO v_key_id, v_key_secret
    FROM profiles
   WHERE id = p_user_id;

  IF v_key_id IS NULL OR v_key_id = '' THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object('key_id', v_key_id, 'key_secret', v_key_secret);
END;
$$;

-- Only service_role can read raw keys
REVOKE ALL ON FUNCTION rpc_get_user_alpaca_keys(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_user_alpaca_keys(uuid) TO service_role;

-- ─── 3. RPC: Check total allocated budget for live agents ────────────────────

CREATE OR REPLACE FUNCTION rpc_check_live_budget(p_user_id uuid, p_new_budget numeric)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total_allocated numeric;
BEGIN
  SELECT COALESCE(SUM(budget), 0)
    INTO v_total_allocated
    FROM agents
   WHERE user_id = p_user_id
     AND mode = 'live'
     AND status != 'stopped';

  RETURN json_build_object(
    'total_allocated', v_total_allocated,
    'new_total',       v_total_allocated + p_new_budget
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_check_live_budget(uuid, numeric) TO authenticated;

-- ─── 4. RPC: Close all positions for an agent (cash out) ─────────────────────
-- Returns the list of positions to close. Actual Alpaca orders are placed
-- by the edge function; this just provides the data and pauses the agent.

CREATE OR REPLACE FUNCTION rpc_cash_out_agent(p_agent_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agent   agents%ROWTYPE;
  v_positions json;
BEGIN
  SELECT * INTO v_agent FROM agents WHERE id = p_agent_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found or not owned by user';
  END IF;

  -- Pause the agent immediately
  UPDATE agents SET status = 'paused'::agent_status, updated_at = now()
   WHERE id = p_agent_id;

  -- Calculate net position per symbol from trades
  SELECT json_agg(pos) INTO v_positions
  FROM (
    SELECT
      symbol,
      SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END) AS net_qty,
      -- Weighted avg cost for longs
      CASE
        WHEN SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END) > 0
        THEN SUM(CASE WHEN side = 'buy' THEN quantity * price ELSE 0 END)
           / NULLIF(SUM(CASE WHEN side = 'buy' THEN quantity ELSE 0 END), 0)
        ELSE SUM(CASE WHEN side = 'sell' THEN quantity * price ELSE 0 END)
           / NULLIF(SUM(CASE WHEN side = 'sell' THEN quantity ELSE 0 END), 0)
      END AS avg_cost
    FROM trades
    WHERE agent_id = p_agent_id
    GROUP BY symbol
    HAVING ABS(SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END)) > 0.00001
  ) pos;

  RETURN json_build_object(
    'agent_id', p_agent_id,
    'agent_name', v_agent.name,
    'mode', v_agent.mode,
    'positions', COALESCE(v_positions, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_cash_out_agent(uuid) TO authenticated;

-- ─── 5. RPC: Get portfolio value by mode ─────────────────────────────────────
-- Returns {value, realized_pnl, budget_total, agent_count} for a given mode.

CREATE OR REPLACE FUNCTION rpc_get_portfolio_by_mode(p_user_id uuid, p_mode text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_budget_total  numeric;
  v_realized_pnl  numeric;
  v_agent_count   integer;
BEGIN
  SELECT
    COALESCE(SUM(budget), 0),
    COALESCE(SUM(pnl), 0),
    COUNT(*)
  INTO v_budget_total, v_realized_pnl, v_agent_count
  FROM agents
  WHERE user_id = p_user_id
    AND mode = p_mode::agent_mode
    AND status != 'stopped';

  RETURN json_build_object(
    'budget_total',  v_budget_total,
    'realized_pnl',  v_realized_pnl,
    'value',         v_budget_total + v_realized_pnl,
    'agent_count',   v_agent_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_portfolio_by_mode(uuid, text) TO authenticated;
