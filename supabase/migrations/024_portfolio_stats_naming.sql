-- 024_portfolio_stats_naming.sql
-- Adds `total_trades` (all rows) and renames the old count to `closed_trades`
-- so the UI can display both "77 total / 4 closed" style labels.
-- All win-rate and P&L aggregates continue to compute from closed_trades only.

DROP FUNCTION IF EXISTS rpc_get_portfolio_stats(uuid);

CREATE OR REPLACE FUNCTION rpc_get_portfolio_stats(p_user_id uuid)
RETURNS TABLE (
  total_trades        bigint,   -- every buy + sell row for this user
  closed_trades       bigint,   -- sells/covers with non-zero pnl (realized P&L)
  winning_trades      bigint,
  win_rate            numeric,
  total_pnl           numeric,
  avg_trade_pnl       numeric,
  best_trade_symbol   text,
  best_trade_pnl      numeric,
  worst_trade_symbol  text,
  worst_trade_pnl     numeric,
  active_since        timestamptz,
  sharpe_ratio        numeric,
  max_drawdown_pct    numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH user_trades AS (
    SELECT tr.*
    FROM trades tr
    JOIN agents a ON a.id = tr.agent_id
    WHERE a.user_id = p_user_id
  ),
  closed_trades AS (
    -- Trades that actually realized P&L (sells with non-zero pnl, plus short covers)
    SELECT * FROM user_trades
    WHERE (side = 'sell' AND pnl IS NOT NULL AND pnl <> 0)
       OR (side = 'buy'  AND pnl IS NOT NULL AND pnl <> 0)
  ),
  trade_stats AS (
    SELECT
      COUNT(*)                                       AS closed_count,
      COUNT(*) FILTER (WHERE pnl > 0)                AS winning_trades,
      CASE WHEN COUNT(*) > 0
           THEN (COUNT(*) FILTER (WHERE pnl > 0)::numeric / COUNT(*)) * 100
           ELSE 0 END                                AS win_rate,
      COALESCE(SUM(pnl), 0)                          AS total_pnl,
      CASE WHEN COUNT(*) > 0 THEN AVG(pnl) ELSE 0 END AS avg_trade_pnl
    FROM closed_trades
  ),
  all_trade_count AS (
    SELECT COUNT(*) AS all_count FROM user_trades
  ),
  active_since_calc AS (
    SELECT MIN(executed_at) AS first_trade FROM user_trades
  ),
  budget_total AS (
    SELECT COALESCE(SUM(budget), 0) AS total_budget
    FROM agents WHERE user_id = p_user_id
  ),
  daily_pnl AS (
    SELECT
      DATE(executed_at) AS d,
      SUM(pnl)          AS day_pnl
    FROM closed_trades
    GROUP BY DATE(executed_at)
    ORDER BY DATE(executed_at)
  ),
  daily_returns AS (
    SELECT
      d,
      day_pnl,
      CASE WHEN (SELECT total_budget FROM budget_total) > 0
           THEN day_pnl / (SELECT total_budget FROM budget_total)
           ELSE 0 END AS ret
    FROM daily_pnl
  ),
  sharpe_calc AS (
    SELECT
      CASE WHEN COUNT(*) >= 3 AND STDDEV(ret) > 0
           THEN ((AVG(ret) * 252) - 0.045) / (STDDEV(ret) * SQRT(252))
           ELSE NULL END AS sharpe_ratio
    FROM daily_returns
  ),
  cumulative AS (
    SELECT
      d,
      SUM(day_pnl) OVER (ORDER BY d) AS cum_pnl
    FROM daily_pnl
  ),
  with_peak AS (
    SELECT
      cum_pnl,
      MAX(cum_pnl) OVER (ORDER BY d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak
    FROM cumulative
  ),
  dd_calc AS (
    SELECT
      CASE WHEN ((SELECT total_budget FROM budget_total) + peak) > 0
           THEN ((peak - cum_pnl) / ((SELECT total_budget FROM budget_total) + peak)) * 100
           ELSE 0 END AS drawdown_pct
    FROM with_peak
  ),
  max_dd AS (
    SELECT COALESCE(MAX(drawdown_pct), 0) AS max_drawdown_pct FROM dd_calc
  )
  SELECT
    atc.all_count                                                       AS total_trades,
    ts.closed_count                                                     AS closed_trades,
    ts.winning_trades,
    ts.win_rate,
    ts.total_pnl,
    ts.avg_trade_pnl,
    COALESCE((SELECT symbol FROM closed_trades ORDER BY pnl DESC LIMIT 1), '—') AS best_trade_symbol,
    COALESCE((SELECT pnl    FROM closed_trades ORDER BY pnl DESC LIMIT 1), 0)   AS best_trade_pnl,
    COALESCE((SELECT symbol FROM closed_trades ORDER BY pnl ASC  LIMIT 1), '—') AS worst_trade_symbol,
    COALESCE((SELECT pnl    FROM closed_trades ORDER BY pnl ASC  LIMIT 1), 0)   AS worst_trade_pnl,
    asc1.first_trade                                                    AS active_since,
    sc.sharpe_ratio,
    md.max_drawdown_pct
  FROM trade_stats ts
  CROSS JOIN all_trade_count atc
  CROSS JOIN active_since_calc asc1
  CROSS JOIN sharpe_calc sc
  CROSS JOIN max_dd md;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_portfolio_stats(uuid) TO authenticated;
