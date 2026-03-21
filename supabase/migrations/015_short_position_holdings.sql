-- ─────────────────────────────────────────────────────────────────────────────
-- 015_short_position_holdings.sql
-- Update holdings RPCs to correctly handle short positions (negative net qty).
-- A short position has qty_sold > qty_bought — previously filtered out.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Per-agent holdings (supports both long and short) ─────────────────────
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
  WITH all_trades AS (
    SELECT symbol, side, quantity, price, executed_at
    FROM trades WHERE agent_id = p_agent_id
  ),
  buys AS (
    SELECT symbol,
           SUM(quantity)              AS qty_bought,
           SUM(price * quantity)      AS cost_basis
    FROM all_trades WHERE side = 'buy'
    GROUP BY symbol
  ),
  sells AS (
    SELECT symbol,
           SUM(quantity)              AS qty_sold,
           SUM(price * quantity)      AS sell_basis
    FROM all_trades WHERE side = 'sell'
    GROUP BY symbol
  ),
  combined AS (
    SELECT
      COALESCE(b.symbol, s.symbol)   AS symbol,
      COALESCE(b.qty_bought, 0)      AS qty_bought,
      COALESCE(s.qty_sold,   0)      AS qty_sold,
      COALESCE(b.cost_basis, 0)      AS cost_basis,
      COALESCE(s.sell_basis, 0)      AS sell_basis
    FROM buys b FULL OUTER JOIN sells s ON b.symbol = s.symbol
  ),
  last_prices AS (
    SELECT DISTINCT ON (symbol) symbol, price AS last_price
    FROM all_trades
    ORDER BY symbol, executed_at DESC
  ),
  price_histories AS (
    SELECT sym_data.symbol,
           array_agg(sym_data.price ORDER BY sym_data.executed_at) AS price_hist
    FROM (
      SELECT symbol, price, executed_at,
             row_number() OVER (PARTITION BY symbol ORDER BY executed_at DESC) AS rn
      FROM all_trades
    ) sym_data
    WHERE sym_data.rn <= 7
    GROUP BY sym_data.symbol
  ),
  holdings AS (
    SELECT c.symbol,
           c.qty_bought - c.qty_sold  AS net_qty,
           -- Long: avg buy price  |  Short: avg short-entry (sell) price
           CASE WHEN c.qty_bought >= c.qty_sold
                THEN c.cost_basis  / NULLIF(c.qty_bought, 0)
                ELSE c.sell_basis  / NULLIF(c.qty_sold,   0)
           END                        AS avg_cost,
           lp.last_price,
           ph.price_hist
    FROM combined c
    LEFT JOIN last_prices     lp ON lp.symbol = c.symbol
    LEFT JOIN price_histories ph ON ph.symbol = c.symbol
    WHERE ABS(c.qty_bought - c.qty_sold) > 0.00001
  )
  SELECT
    h.symbol,
    h.net_qty                                       AS quantity,
    h.avg_cost,
    h.last_price,
    -- For shorts: current_value is negative (we owe the market those shares)
    h.last_price * h.net_qty                        AS current_value,
    -- Long P&L:  (price − cost)  × qty  (positive when price rose)
    -- Short P&L: (cost − price)  × |qty| (positive when price fell)
    CASE WHEN h.net_qty > 0
         THEN (h.last_price - h.avg_cost) * h.net_qty
         ELSE (h.avg_cost - h.last_price) * ABS(h.net_qty)
    END                                             AS unrealized_pnl,
    CASE WHEN h.avg_cost > 0 AND h.net_qty > 0
         THEN ((h.last_price - h.avg_cost) / h.avg_cost) * 100
         WHEN h.avg_cost > 0 AND h.net_qty < 0
         THEN ((h.avg_cost - h.last_price) / h.avg_cost) * 100
         ELSE 0
    END                                             AS unrealized_pnl_pct,
    COALESCE(h.price_hist, ARRAY[h.last_price]::numeric[]) AS price_history
  FROM holdings h
  ORDER BY ABS(h.last_price * h.net_qty) DESC;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_agent_holdings(uuid) TO authenticated;

-- ── 2. Portfolio-wide holdings (supports shorts) ─────────────────────────────
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
  price_history       numeric[]
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
    SELECT symbol,
           SUM(quantity)              AS qty_sold,
           SUM(price * quantity)      AS sell_basis,
           COUNT(DISTINCT agent_id)   AS agent_count_val
    FROM user_trades WHERE side = 'sell'
    GROUP BY symbol
  ),
  combined AS (
    SELECT
      COALESCE(b.symbol, s.symbol)                                   AS symbol,
      COALESCE(b.qty_bought, 0)                                      AS qty_bought,
      COALESCE(s.qty_sold,   0)                                      AS qty_sold,
      COALESCE(b.cost_basis, 0)                                      AS cost_basis,
      COALESCE(s.sell_basis, 0)                                      AS sell_basis,
      GREATEST(COALESCE(b.agent_count_val, 0),
               COALESCE(s.agent_count_val, 0))::int                  AS agent_count
    FROM buys b FULL OUTER JOIN sells s ON b.symbol = s.symbol
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
    SELECT c.symbol,
           c.qty_bought - c.qty_sold  AS net_qty,
           CASE WHEN c.qty_bought >= c.qty_sold
                THEN c.cost_basis  / NULLIF(c.qty_bought, 0)
                ELSE c.sell_basis  / NULLIF(c.qty_sold,   0)
           END                        AS avg_cost,
           lp.last_price,
           c.agent_count,
           ph.price_hist
    FROM combined c
    LEFT JOIN last_prices     lp ON lp.symbol = c.symbol
    LEFT JOIN price_histories ph ON ph.symbol = c.symbol
    WHERE ABS(c.qty_bought - c.qty_sold) > 0.00001
  )
  SELECT
    h.symbol,
    h.net_qty                                       AS total_quantity,
    h.avg_cost,
    h.last_price,
    h.last_price * h.net_qty                        AS current_value,
    CASE WHEN h.net_qty > 0
         THEN (h.last_price - h.avg_cost) * h.net_qty
         ELSE (h.avg_cost - h.last_price) * ABS(h.net_qty)
    END                                             AS unrealized_pnl,
    CASE WHEN h.avg_cost > 0 AND h.net_qty > 0
         THEN ((h.last_price - h.avg_cost) / h.avg_cost) * 100
         WHEN h.avg_cost > 0 AND h.net_qty < 0
         THEN ((h.avg_cost - h.last_price) / h.avg_cost) * 100
         ELSE 0
    END                                             AS unrealized_pnl_pct,
    h.agent_count,
    COALESCE(h.price_hist, ARRAY[h.last_price]::numeric[]) AS price_history
  FROM holdings h
  ORDER BY ABS(h.last_price * h.net_qty) DESC;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_portfolio_holdings(uuid) TO authenticated;
