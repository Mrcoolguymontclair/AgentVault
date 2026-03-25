-- 020_portfolio_report.sql
-- Generates a full portfolio report as JSON in one RPC call.

CREATE OR REPLACE FUNCTION rpc_generate_portfolio_report(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_agents json;
  v_daily json;
  v_logs json;
  v_summary json;
BEGIN
  -- ─── Portfolio Summary ─────────────────────────────────────────────────
  SELECT json_build_object(
    'total_budget',   COALESCE(SUM(budget), 0),
    'total_pnl',      COALESCE(SUM(pnl), 0),
    'total_trades',   COALESCE(SUM(trades_count), 0),
    'avg_win_rate',   CASE WHEN COUNT(*) > 0
                        THEN ROUND(AVG(win_rate)::numeric, 2)
                        ELSE 0 END,
    'agent_count',    COUNT(*),
    'active_agents',  COUNT(*) FILTER (WHERE status = 'active'),
    'generated_at',   now()
  ) INTO v_summary
  FROM agents
  WHERE user_id = p_user_id AND status != 'stopped';

  -- ─── Per-Agent Breakdown ───────────────────────────────────────────────
  SELECT json_agg(agent_row ORDER BY agent_row->>'pnl' DESC) INTO v_agents
  FROM (
    SELECT json_build_object(
      'id',          a.id,
      'name',        a.name,
      'strategy',    a.strategy,
      'status',      a.status,
      'mode',        a.mode,
      'budget',      a.budget,
      'pnl',         a.pnl,
      'pnl_pct',     a.pnl_pct,
      'trades_count', a.trades_count,
      'win_rate',    a.win_rate,
      'max_drawdown', a.max_drawdown,
      'sharpe_ratio', a.sharpe_ratio,
      'created_at',  a.created_at,
      'holdings',    COALESCE((
        SELECT json_agg(json_build_object(
          'symbol',   h.symbol,
          'net_qty',  h.net_qty,
          'avg_cost', h.avg_cost
        ))
        FROM (
          SELECT
            symbol,
            SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END) AS net_qty,
            CASE
              WHEN SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END) > 0
              THEN SUM(CASE WHEN side = 'buy' THEN quantity * price ELSE 0 END)
                 / NULLIF(SUM(CASE WHEN side = 'buy' THEN quantity ELSE 0 END), 0)
              ELSE SUM(CASE WHEN side = 'sell' THEN quantity * price ELSE 0 END)
                 / NULLIF(SUM(CASE WHEN side = 'sell' THEN quantity ELSE 0 END), 0)
            END AS avg_cost
          FROM trades
          WHERE agent_id = a.id
          GROUP BY symbol
          HAVING ABS(SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END)) > 0.0001
        ) h
      ), '[]'::json),
      'recent_trades', COALESCE((
        SELECT json_agg(json_build_object(
          'executed_at', t.executed_at,
          'symbol',      t.symbol,
          'side',        t.side,
          'quantity',     t.quantity,
          'price',       t.price,
          'pnl',         t.pnl
        ) ORDER BY t.executed_at DESC)
        FROM (
          SELECT * FROM trades
          WHERE agent_id = a.id
          ORDER BY executed_at DESC
          LIMIT 10
        ) t
      ), '[]'::json)
    ) AS agent_row
    FROM agents a
    WHERE a.user_id = p_user_id AND a.status != 'stopped'
  ) sub;

  -- ─── Daily Summary ─────────────────────────────────────────────────────
  SELECT json_agg(json_build_object(
    'date',        d.trade_date,
    'trades',      d.trade_count,
    'pnl',         d.daily_pnl
  ) ORDER BY d.trade_date DESC) INTO v_daily
  FROM (
    SELECT
      (executed_at AT TIME ZONE 'America/New_York')::date AS trade_date,
      COUNT(*)                                            AS trade_count,
      SUM(pnl)                                            AS daily_pnl
    FROM trades
    WHERE user_id = p_user_id
    GROUP BY (executed_at AT TIME ZONE 'America/New_York')::date
  ) d;

  -- ─── Recent Agent Logs ─────────────────────────────────────────────────
  SELECT json_agg(json_build_object(
    'logged_at',     l.created_at,
    'agent_name',    a.name,
    'strategy',      a.strategy,
    'action',        l.action,
    'symbol',        l.symbol,
    'signal_data',   l.signal_data,
    'ai_reasoning',  l.ai_reasoning,
    'skip_reason',   l.skip_reason
  ) ORDER BY l.created_at DESC) INTO v_logs
  FROM (
    SELECT * FROM agent_logs
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 50
  ) l
  JOIN agents a ON a.id = l.agent_id;

  RETURN json_build_object(
    'summary',       COALESCE(v_summary, '{}'::json),
    'agents',        COALESCE(v_agents, '[]'::json),
    'daily_summary', COALESCE(v_daily, '[]'::json),
    'recent_logs',   COALESCE(v_logs, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_generate_portfolio_report(uuid) TO authenticated;
