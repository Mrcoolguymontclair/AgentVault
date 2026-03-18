-- ─────────────────────────────────────────────────────────────────────────────
-- 012_status_page.sql
-- Single RPC that returns a full daily trading summary as JSON.
-- Granted to anon so the /status page works without a logged-in session.
-- Security is handled at the app layer (secret key in URL).
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS rpc_get_daily_status(text);

CREATE OR REPLACE FUNCTION rpc_get_daily_status(p_date text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date    date;
  v_summary jsonb;
  v_agents  jsonb;
  v_trades  jsonb;
  v_logs    jsonb;
BEGIN
  v_date := COALESCE(p_date::date, (now() AT TIME ZONE 'America/New_York')::date);

  -- ── Summary ───────────────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'total_trades',   COUNT(*),
    'total_pnl',      COALESCE(SUM(pnl), 0),
    'winning_trades', COUNT(*) FILTER (WHERE pnl > 0),
    'losing_trades',  COUNT(*) FILTER (WHERE pnl < 0),
    'win_rate',       CASE WHEN COUNT(*) > 0
                          THEN ROUND((COUNT(*) FILTER (WHERE pnl > 0)::numeric / COUNT(*)) * 100, 1)
                          ELSE 0 END,
    'best_symbol',    (SELECT symbol FROM trades
                       WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_date
                       ORDER BY pnl DESC NULLS LAST LIMIT 1),
    'best_pnl',       (SELECT pnl    FROM trades
                       WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_date
                       ORDER BY pnl DESC NULLS LAST LIMIT 1),
    'worst_symbol',   (SELECT symbol FROM trades
                       WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_date
                       ORDER BY pnl ASC  NULLS LAST LIMIT 1),
    'worst_pnl',      (SELECT pnl    FROM trades
                       WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_date
                       ORDER BY pnl ASC  NULLS LAST LIMIT 1)
  ) INTO v_summary
  FROM trades
  WHERE DATE(executed_at AT TIME ZONE 'America/New_York') = v_date;

  -- ── Per-agent breakdown (only agents with activity or active status) ───────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'agent_id',       a.id,
        'agent_name',     a.name,
        'strategy',       a.strategy,
        'status',         a.status,
        'mode',           a.mode,
        'trades_today',   stats.trade_count,
        'pnl_today',      stats.pnl_sum,
        'wins_today',     stats.win_count,
        'win_rate_today', CASE WHEN stats.trade_count > 0
                              THEN ROUND((stats.win_count::numeric / stats.trade_count) * 100, 1)
                              ELSE 0 END,
        'last_run',       stats.last_run
      )
      ORDER BY stats.pnl_sum DESC NULLS LAST
    ),
    '[]'::jsonb
  ) INTO v_agents
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                              AS trade_count,
      COALESCE(SUM(pnl), 0)               AS pnl_sum,
      COUNT(*) FILTER (WHERE pnl > 0)      AS win_count,
      MAX(executed_at)                     AS last_run
    FROM trades t
    WHERE t.agent_id = a.id
      AND DATE(t.executed_at AT TIME ZONE 'America/New_York') = v_date
  ) stats ON true
  WHERE stats.trade_count > 0 OR a.status = 'active';

  -- ── All trades today ──────────────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',          t.id,
        'executed_at', t.executed_at,
        'agent_name',  a.name,
        'strategy',    a.strategy,
        'symbol',      t.symbol,
        'side',        t.side,
        'quantity',    t.quantity,
        'price',       t.price,
        'pnl',         t.pnl
      )
      ORDER BY t.executed_at DESC
    ),
    '[]'::jsonb
  ) INTO v_trades
  FROM trades t
  JOIN agents a ON a.id = t.agent_id
  WHERE DATE(t.executed_at AT TIME ZONE 'America/New_York') = v_date;

  -- ── Agent logs today ──────────────────────────────────────────────────────
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',             l.id,
        'timestamp',      l.timestamp,
        'agent_name',     l.agent_name,
        'strategy',       l.strategy,
        'action',         l.action,
        'signal_detected',l.signal_detected,
        'signal_symbol',  l.signal_symbol,
        'signal_side',    l.signal_side,
        'skip_reason',    l.skip_reason,
        'ai_reasoning',   l.ai_reasoning,
        'trade_symbol',   l.trade_symbol,
        'trade_price',    l.trade_price,
        'trade_pnl',      l.trade_pnl,
        'ai_confidence',  l.ai_confidence
      )
      ORDER BY l.timestamp DESC
    ),
    '[]'::jsonb
  ) INTO v_logs
  FROM agent_logs l
  WHERE DATE(l.timestamp AT TIME ZONE 'America/New_York') = v_date
  LIMIT 200;

  RETURN jsonb_build_object(
    'date',         v_date::text,
    'generated_at', now(),
    'summary',      COALESCE(v_summary, '{}'::jsonb),
    'agents',       COALESCE(v_agents,  '[]'::jsonb),
    'trades',       COALESCE(v_trades,  '[]'::jsonb),
    'logs',         COALESCE(v_logs,    '[]'::jsonb)
  );
END;
$$;

-- Allow the anon key (unauthenticated) to call this
-- The app-layer key check (URL param) is the access gate
GRANT EXECUTE ON FUNCTION rpc_get_daily_status(text) TO anon;
GRANT EXECUTE ON FUNCTION rpc_get_daily_status(text) TO authenticated;
