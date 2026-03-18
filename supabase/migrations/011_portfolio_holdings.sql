-- ─────────────────────────────────────────────────────────────────────────────
-- 011_portfolio_holdings.sql
-- Three RPC functions powering the full portfolio overview UI:
--   rpc_get_portfolio_holdings  — net holdings across all agents
--   rpc_get_portfolio_stats     — Sharpe, max DD, win rate, best/worst trade
--   rpc_get_agent_holdings      — per-agent net holdings
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Portfolio-wide holdings ───────────────────────────────────────────────
DROP FUNCTION IF EXISTS rpc_get_portfolio_holdings(uuid);
CREATE OR REPLACE FUNCTION rpc_get_portfolio_holdings(p_user_id uuid)
RETURNS TABLE (
  symbol              text,
  total_quantity      numeric,
  avg_cost            numeric,
  last_price          numeric,
  current_value       numeric,
  unrealized_pnl      numeric,
  unrealized_pnl_pct  numeric,
  agent_count         int,
  price_history       numeric[]   -- last ≤7 prices in chronological order (sparkline)
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH user_trades AS (
    SELECT tr.*
    FROM trades tr
    JOIN agents a ON a.id = tr.agent_id
    WHERE a.user_id = p_user_id
  ),
  buys AS (
    SELECT symbol,
           SUM(quantity)              AS qty_bought,
           SUM(price * quantity)      AS cost_basis,
           COUNT(DISTINCT agent_id)   AS agent_count_val
    FROM user_trades WHERE side = 'buy'
    GROUP BY symbol
  ),
  sells AS (
    SELECT symbol, SUM(quantity) AS qty_sold
    FROM user_trades WHERE side = 'sell'
    GROUP BY symbol
  ),
  last_prices AS (
    SELECT DISTINCT ON (symbol) symbol, price AS last_price
    FROM user_trades
    ORDER BY symbol, executed_at DESC
  ),
  price_histories AS (
    SELECT sym_data.symbol,
           array_agg(sym_data.price ORDER BY sym_data.executed_at) AS price_hist
    FROM (
      SELECT symbol, price, executed_at,
             row_number() OVER (PARTITION BY symbol ORDER BY executed_at DESC) AS rn
      FROM user_trades
    ) sym_data
    WHERE sym_data.rn <= 7
    GROUP BY sym_data.symbol
  ),
  holdings AS (
    SELECT b.symbol,
           b.qty_bought - COALESCE(s.qty_sold, 0)         AS net_qty,
           b.cost_basis / NULLIF(b.qty_bought, 0)         AS avg_cost,
           lp.last_price,
           b.agent_count_val::int                         AS agent_count,
           ph.price_hist
    FROM buys b
    LEFT JOIN sells s ON s.symbol = b.symbol
    LEFT JOIN last_prices lp ON lp.symbol = b.symbol
    LEFT JOIN price_histories ph ON ph.symbol = b.symbol
    WHERE (b.qty_bought - COALESCE(s.qty_sold, 0)) > 0.00001
  )
  SELECT h.symbol,
         h.net_qty                                          AS total_quantity,
         h.avg_cost,
         h.last_price,
         h.last_price * h.net_qty                          AS current_value,
         (h.last_price - h.avg_cost) * h.net_qty           AS unrealized_pnl,
         CASE WHEN h.avg_cost > 0
              THEN ((h.last_price - h.avg_cost) / h.avg_cost) * 100
              ELSE 0 END                                   AS unrealized_pnl_pct,
         h.agent_count,
         COALESCE(h.price_hist, ARRAY[h.last_price]::numeric[]) AS price_history
  FROM holdings h
  ORDER BY (h.last_price * h.net_qty) DESC;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_portfolio_holdings(uuid) TO authenticated;

-- ── 2. Portfolio-wide performance stats ──────────────────────────────────────
DROP FUNCTION IF EXISTS rpc_get_portfolio_stats(uuid);
CREATE OR REPLACE FUNCTION rpc_get_portfolio_stats(p_user_id uuid)
RETURNS TABLE (
  total_trades        bigint,
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
    WHERE a.user_id = p_user_id AND tr.pnl IS NOT NULL
  ),
  trade_stats AS (
    SELECT
      COUNT(*)                                                AS total_trades,
      COUNT(*) FILTER (WHERE pnl > 0)                       AS winning_trades,
      CASE WHEN COUNT(*) > 0
           THEN (COUNT(*) FILTER (WHERE pnl > 0)::numeric / COUNT(*)) * 100
           ELSE 0 END                                        AS win_rate,
      COALESCE(SUM(pnl), 0)                                 AS total_pnl,
      CASE WHEN COUNT(*) > 0 THEN AVG(pnl) ELSE 0 END      AS avg_trade_pnl,
      MIN(executed_at)                                       AS active_since
    FROM user_trades
  ),
  -- Portfolio snapshots aggregated by date for Sharpe + Max DD
  snap_daily AS (
    SELECT snapshot_date, SUM(portfolio_value) AS port_value
    FROM portfolio_snapshots
    WHERE user_id = p_user_id
    GROUP BY snapshot_date
    ORDER BY snapshot_date
  ),
  daily_returns AS (
    SELECT
      port_value,
      LAG(port_value) OVER (ORDER BY snapshot_date) AS prev_value
    FROM snap_daily
  ),
  returns_calc AS (
    SELECT
      CASE WHEN prev_value > 0 THEN (port_value - prev_value) / prev_value ELSE 0 END AS ret
    FROM daily_returns
    WHERE prev_value IS NOT NULL AND prev_value > 0
  ),
  sharpe_calc AS (
    SELECT
      CASE WHEN COUNT(*) >= 5 AND STDDEV(ret) > 0
           THEN ((AVG(ret) * 252) - 0.045) / (STDDEV(ret) * SQRT(252))
           ELSE NULL END AS sharpe_ratio
    FROM returns_calc
  ),
  peaks AS (
    SELECT port_value,
           MAX(port_value) OVER (ORDER BY snapshot_date
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak
    FROM snap_daily
  ),
  dd_calc AS (
    SELECT
      CASE WHEN peak > 0 THEN (peak - port_value) / peak * 100 ELSE 0 END AS drawdown_pct
    FROM peaks
  ),
  max_dd AS (
    SELECT COALESCE(MAX(drawdown_pct), 0) AS max_drawdown_pct FROM dd_calc
  )
  SELECT
    ts.total_trades,
    ts.winning_trades,
    ts.win_rate,
    ts.total_pnl,
    ts.avg_trade_pnl,
    COALESCE((SELECT symbol FROM user_trades ORDER BY pnl DESC LIMIT 1), '—') AS best_trade_symbol,
    COALESCE((SELECT pnl   FROM user_trades ORDER BY pnl DESC LIMIT 1), 0)   AS best_trade_pnl,
    COALESCE((SELECT symbol FROM user_trades ORDER BY pnl ASC  LIMIT 1), '—') AS worst_trade_symbol,
    COALESCE((SELECT pnl   FROM user_trades ORDER BY pnl ASC  LIMIT 1), 0)   AS worst_trade_pnl,
    ts.active_since,
    sc.sharpe_ratio,
    md.max_drawdown_pct
  FROM trade_stats ts
  CROSS JOIN sharpe_calc sc
  CROSS JOIN max_dd md;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_portfolio_stats(uuid) TO authenticated;

-- ── 3. Per-agent holdings ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS rpc_get_agent_holdings(uuid);
CREATE OR REPLACE FUNCTION rpc_get_agent_holdings(p_agent_id uuid)
RETURNS TABLE (
  symbol              text,
  quantity            numeric,
  avg_cost            numeric,
  last_price          numeric,
  current_value       numeric,
  unrealized_pnl      numeric,
  unrealized_pnl_pct  numeric,
  price_history       numeric[]
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH buys AS (
    SELECT symbol, SUM(quantity) AS qty_bought, SUM(price * quantity) AS cost_basis
    FROM trades WHERE agent_id = p_agent_id AND side = 'buy'
    GROUP BY symbol
  ),
  sells AS (
    SELECT symbol, SUM(quantity) AS qty_sold
    FROM trades WHERE agent_id = p_agent_id AND side = 'sell'
    GROUP BY symbol
  ),
  last_prices AS (
    SELECT DISTINCT ON (symbol) symbol, price AS last_price
    FROM trades WHERE agent_id = p_agent_id
    ORDER BY symbol, executed_at DESC
  ),
  price_histories AS (
    SELECT sym_data.symbol,
           array_agg(sym_data.price ORDER BY sym_data.executed_at) AS price_hist
    FROM (
      SELECT symbol, price, executed_at,
             row_number() OVER (PARTITION BY symbol ORDER BY executed_at DESC) AS rn
      FROM trades WHERE agent_id = p_agent_id
    ) sym_data
    WHERE sym_data.rn <= 7
    GROUP BY sym_data.symbol
  ),
  holdings AS (
    SELECT b.symbol,
           b.qty_bought - COALESCE(s.qty_sold, 0)         AS net_qty,
           b.cost_basis / NULLIF(b.qty_bought, 0)         AS avg_cost,
           lp.last_price,
           ph.price_hist
    FROM buys b
    LEFT JOIN sells s ON s.symbol = b.symbol
    LEFT JOIN last_prices lp ON lp.symbol = b.symbol
    LEFT JOIN price_histories ph ON ph.symbol = b.symbol
    WHERE (b.qty_bought - COALESCE(s.qty_sold, 0)) > 0.00001
  )
  SELECT h.symbol,
         h.net_qty                                          AS quantity,
         h.avg_cost,
         h.last_price,
         h.last_price * h.net_qty                          AS current_value,
         (h.last_price - h.avg_cost) * h.net_qty           AS unrealized_pnl,
         CASE WHEN h.avg_cost > 0
              THEN ((h.last_price - h.avg_cost) / h.avg_cost) * 100
              ELSE 0 END                                   AS unrealized_pnl_pct,
         COALESCE(h.price_hist, ARRAY[h.last_price]::numeric[]) AS price_history
  FROM holdings h
  ORDER BY (h.last_price * h.net_qty) DESC;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_agent_holdings(uuid) TO authenticated;
