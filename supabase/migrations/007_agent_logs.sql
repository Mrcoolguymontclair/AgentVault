-- ─────────────────────────────────────────────────────────────────────────────
-- 007_agent_logs.sql
-- Agent execution log table + RPCs for debug mode
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create agent_logs table
CREATE TABLE IF NOT EXISTS agent_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  agent_name text NOT NULL,
  strategy text NOT NULL,
  timestamp timestamptz DEFAULT now(),
  signal_detected boolean DEFAULT false,
  signal_symbol text,
  signal_side text,
  ai_reasoning text,
  ai_confidence numeric(5,4),
  action text NOT NULL CHECK (action IN ('traded', 'skipped', 'error')),
  skip_reason text,
  trade_symbol text,
  trade_qty numeric,
  trade_price numeric,
  trade_pnl numeric
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_user_id ON agent_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(timestamp DESC);

-- RLS
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own logs" ON agent_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can insert logs" ON agent_logs FOR INSERT WITH CHECK (true);

-- 2. Fetch logs (user-level, optionally filtered by agent)
CREATE OR REPLACE FUNCTION rpc_get_agent_logs(
  p_user_id uuid,
  p_agent_id uuid DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS SETOF agent_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM agent_logs
  WHERE user_id = p_user_id
    AND (p_agent_id IS NULL OR agent_id = p_agent_id)
  ORDER BY timestamp DESC
  LIMIT p_limit;
END;
$$;

-- 3. Clear all logs for a user
CREATE OR REPLACE FUNCTION rpc_clear_agent_logs(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM agent_logs WHERE user_id = p_user_id;
END;
$$;

-- 4. Reset an agent's stats and trade history
CREATE OR REPLACE FUNCTION rpc_reset_agent_stats(
  p_agent_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agents WHERE id = p_agent_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Not authorized or agent not found';
  END IF;
  DELETE FROM trades WHERE agent_id = p_agent_id;
  DELETE FROM portfolio_snapshots WHERE agent_id = p_agent_id;
  DELETE FROM agent_logs WHERE agent_id = p_agent_id;
  UPDATE agents SET
    pnl = 0, pnl_pct = 0, trades_count = 0, win_rate = 0,
    max_drawdown = 0, sharpe_ratio = 0, updated_at = now()
  WHERE id = p_agent_id AND user_id = p_user_id;
END;
$$;

-- 5. Insert a simulated trade (debug only)
CREATE OR REPLACE FUNCTION rpc_simulate_trade(
  p_agent_id uuid,
  p_user_id uuid,
  p_symbol text,
  p_side text,
  p_qty numeric,
  p_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pnl numeric := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agents WHERE id = p_agent_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  INSERT INTO trades (agent_id, user_id, symbol, side, quantity, price, pnl, executed_at)
  VALUES (p_agent_id, p_user_id, p_symbol, p_side, p_qty, p_price, v_pnl, now());
END;
$$;

-- 6. Raw data viewer (only allows safe tables)
CREATE OR REPLACE FUNCTION rpc_debug_table(
  p_user_id uuid,
  p_table text,
  p_limit int DEFAULT 20
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  IF p_table = 'agents' THEN
    SELECT json_agg(row_to_json(a.*)) INTO v_result
    FROM (SELECT * FROM agents WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT p_limit) a;
  ELSIF p_table = 'trades' THEN
    SELECT json_agg(row_to_json(t.*)) INTO v_result
    FROM (SELECT * FROM trades WHERE user_id = p_user_id ORDER BY executed_at DESC LIMIT p_limit) t;
  ELSIF p_table = 'agent_logs' THEN
    SELECT json_agg(row_to_json(l.*)) INTO v_result
    FROM (SELECT * FROM agent_logs WHERE user_id = p_user_id ORDER BY timestamp DESC LIMIT p_limit) l;
  ELSIF p_table = 'notifications' THEN
    SELECT json_agg(row_to_json(n.*)) INTO v_result
    FROM (SELECT * FROM notifications WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT p_limit) n;
  ELSIF p_table = 'profiles' THEN
    SELECT json_agg(row_to_json(p.*)) INTO v_result
    FROM (SELECT * FROM profiles WHERE id = p_user_id LIMIT 1) p;
  ELSE
    RETURN '[]'::json;
  END IF;
  RETURN COALESCE(v_result, '[]'::json);
END;
$$;
