-- ─────────────────────────────────────────────────────────────────────────────
-- 013_status_rpcs.sql
-- Three public RPCs that power the /status page.
-- Each validates a secret key so random callers get nothing back.
-- Granted to anon — the app never needs a session to call these.
-- ─────────────────────────────────────────────────────────────────────────────

-- Shared helper: validate the secret key
-- Change this value to rotate the status-page password.
CREATE OR REPLACE FUNCTION _status_key_ok(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_key = 'agentvault2026';
$$;

-- ── 1. rpc_get_status_summary ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS rpc_get_status_summary(text);
CREATE OR REPLACE FUNCTION rpc_get_status_summary(p_secret_key text)
RETURNS TABLE (
  today_date       text,
  total_trades     bigint,
  total_pnl        numeric,
  winning_trades   bigint,
  losing_trades    bigint,
  win_rate         numeric,
  best_symbol      text,
  best_pnl         numeric,
  worst_symbol     text,
  worst_pnl        numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF NOT _status_key_ok(p_secret_key) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    v_today::text,
    COUNT(*)::bigint,
    COALESCE(SUM(t.pnl), 0),
    COUNT(*) FILTER (WHERE t.pnl > 0),
    COUNT(*) FILTER (WHERE t.pnl < 0),
    CASE WHEN COUNT(*) > 0
         THEN ROUND((COUNT(*) FILTER (WHERE t.pnl > 0)::numeric / COUNT(*)) * 100, 1)
         ELSE 0 END,
    (SELECT symbol FROM trades WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_today ORDER BY pnl DESC NULLS LAST LIMIT 1),
    (SELECT pnl    FROM trades WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_today ORDER BY pnl DESC NULLS LAST LIMIT 1),
    (SELECT symbol FROM trades WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_today ORDER BY pnl ASC  NULLS LAST LIMIT 1),
    (SELECT pnl    FROM trades WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_today ORDER BY pnl ASC  NULLS LAST LIMIT 1)
  FROM trades t
  WHERE DATE(t.executed_at AT TIME ZONE 'America/New_York') = v_today;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_status_summary(text) TO anon, authenticated;

-- ── 2. rpc_get_status_agents ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS rpc_get_status_agents(text);
CREATE OR REPLACE FUNCTION rpc_get_status_agents(p_secret_key text)
RETURNS TABLE (
  agent_id        uuid,
  agent_name      text,
  strategy        text,
  status          text,
  mode            text,
  trades_today    bigint,
  pnl_today       numeric,
  wins_today      bigint,
  win_rate_today  numeric,
  last_signal_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF NOT _status_key_ok(p_secret_key) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.strategy,
    a.status,
    a.mode,
    COALESCE(s.trade_count, 0),
    COALESCE(s.pnl_sum,    0),
    COALESCE(s.win_count,  0),
    CASE WHEN COALESCE(s.trade_count, 0) > 0
         THEN ROUND((COALESCE(s.win_count, 0)::numeric / s.trade_count) * 100, 1)
         ELSE 0 END,
    (SELECT timestamp FROM agent_logs
     WHERE agent_id = a.id AND signal_detected = true
     ORDER BY timestamp DESC LIMIT 1)
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                             AS trade_count,
      COALESCE(SUM(t.pnl), 0)            AS pnl_sum,
      COUNT(*) FILTER (WHERE t.pnl > 0)  AS win_count
    FROM trades t
    WHERE t.agent_id = a.id
      AND DATE(t.executed_at AT TIME ZONE 'America/New_York') = v_today
  ) s ON true
  ORDER BY s.pnl_sum DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_status_agents(text) TO anon, authenticated;

-- ── 3. rpc_get_status_logs ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS rpc_get_status_logs(text, int);
CREATE OR REPLACE FUNCTION rpc_get_status_logs(p_secret_key text, p_limit int DEFAULT 20)
RETURNS TABLE (
  log_id          uuid,
  ts              timestamptz,
  agent_name      text,
  strategy        text,
  action          text,
  signal_detected boolean,
  signal_symbol   text,
  signal_side     text,
  skip_reason     text,
  trade_symbol    text,
  trade_qty       numeric,
  trade_price     numeric,
  trade_pnl       numeric,
  ai_confidence   numeric,
  ai_reasoning    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  IF NOT _status_key_ok(p_secret_key) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.timestamp,
    l.agent_name,
    l.strategy,
    l.action,
    l.signal_detected,
    l.signal_symbol,
    l.signal_side,
    l.skip_reason,
    l.trade_symbol,
    l.trade_qty,
    l.trade_price,
    l.trade_pnl,
    l.ai_confidence,
    l.ai_reasoning
  FROM agent_logs l
  WHERE DATE(l.timestamp AT TIME ZONE 'America/New_York') = v_today
  ORDER BY l.timestamp DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_status_logs(text, int) TO anon, authenticated;
