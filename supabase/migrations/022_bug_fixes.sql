-- ─────────────────────────────────────────────────────────────────────────────
-- 022_bug_fixes.sql
--
-- Fixes from the 20-bug audit pass:
--  • Bug  2 — Agent P&L now blends realized + unrealized via new RPC
--  • Bug  4 — Unified win-rate: closed sells only (pnl != 0)
--  • Bug  6 — Refresh agents.trades_count / win_rate / pnl from trades table
--  • Bug 11 — agent_leaderboard view computes counts from trades, not agents row
--  • Bug 17 — Per-agent max drawdown
--  • Bug 18 — Active Since now uses earliest trade (was already correct, but
--             we make sure stale data is purged)
--  • Bug 19 — Best/worst trade = only closed sells with non-zero pnl
--  • Bug 20 — Sharpe recalculated from per-day realized P&L returns
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. rpc_update_agent_stats: count CLOSED trades (sells with non-zero pnl) ──
-- This fixes Bug 4 (win-rate inconsistency) at the source of truth.
DROP FUNCTION IF EXISTS rpc_update_agent_stats(uuid);

CREATE OR REPLACE FUNCTION rpc_update_agent_stats(p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget       numeric;
  v_pnl          numeric;
  v_pnl_pct      numeric;
  v_trades_count bigint;
  v_win_rate     numeric;
  v_closed_total bigint;
  v_closed_wins  bigint;
BEGIN
  SELECT COALESCE(budget, 1000) INTO v_budget
  FROM agents WHERE id = p_agent_id;

  -- Total realized P&L + total trade count (single source of truth)
  SELECT COALESCE(SUM(pnl), 0), COUNT(*)
  INTO v_pnl, v_trades_count
  FROM trades
  WHERE agent_id = p_agent_id;

  -- Win-rate: only closed positions (sells with non-zero pnl)
  SELECT
    COUNT(*) FILTER (WHERE side = 'sell' AND pnl IS NOT NULL AND pnl <> 0),
    COUNT(*) FILTER (WHERE side = 'sell' AND pnl > 0)
  INTO v_closed_total, v_closed_wins
  FROM trades
  WHERE agent_id = p_agent_id;

  v_win_rate := CASE WHEN v_closed_total > 0
                     THEN (v_closed_wins::numeric / v_closed_total) * 100
                     ELSE 0 END;
  v_pnl_pct  := CASE WHEN v_budget > 0 THEN (v_pnl / v_budget) * 100 ELSE 0 END;

  UPDATE agents
  SET
    pnl          = v_pnl,
    pnl_pct      = v_pnl_pct,
    trades_count = v_trades_count,
    win_rate     = v_win_rate,
    updated_at   = now()
  WHERE id = p_agent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_update_agent_stats(uuid) TO service_role, authenticated;

-- ── 2. Backfill: refresh every agent's stats from trades table ────────────────
-- Bug 6: trade counts / win rate / pnl are out of sync across agents.
DO $$
DECLARE
  a RECORD;
BEGIN
  FOR a IN SELECT id FROM agents LOOP
    PERFORM rpc_update_agent_stats(a.id);
  END LOOP;
END $$;

-- ── 3. agent_leaderboard view: compute counts from trades (Bug 11) ────────────
-- Story Seeker has 66 trades in the trades table but agents.trades_count is
-- stale. Compute on-the-fly so the view is always correct.
-- Must DROP first because CREATE OR REPLACE VIEW cannot change column types
-- (existing pnl is numeric(14,2); the new computed pnl is plain numeric).
-- CASCADE drops any dependent views (e.g. leaderboard_view) so they don't block.
DROP VIEW IF EXISTS public.agent_leaderboard CASCADE;

CREATE VIEW public.agent_leaderboard AS
WITH trade_stats AS (
  SELECT
    agent_id,
    COUNT(*)                                                        AS tc,
    COALESCE(SUM(pnl), 0)                                           AS realized_pnl,
    COUNT(*) FILTER (WHERE side = 'sell' AND pnl IS NOT NULL
                       AND pnl <> 0)                                AS closed_total,
    COUNT(*) FILTER (WHERE side = 'sell' AND pnl > 0)               AS closed_wins
  FROM trades
  GROUP BY agent_id
)
SELECT
  a.id,
  a.name,
  a.strategy,
  a.config,
  COALESCE(ts.realized_pnl, a.pnl)                                  AS pnl,
  CASE
    WHEN a.budget > 0 THEN (COALESCE(ts.realized_pnl, a.pnl) / a.budget) * 100
    ELSE 0
  END                                                               AS pnl_pct,
  CASE
    WHEN COALESCE(ts.closed_total, 0) > 0
      THEN (ts.closed_wins::numeric / ts.closed_total) * 100
    ELSE 0
  END                                                               AS win_rate,
  COALESCE(ts.tc, 0)::int                                           AS trades_count,
  a.budget,
  a.mode,
  a.status,
  a.user_id,
  p.display_name,
  p.avatar,
  COALESCE(fc.followers_count, 0)::integer                          AS followers_count,
  RANK() OVER (
    ORDER BY (
      CASE
        WHEN a.budget > 0 THEN (COALESCE(ts.realized_pnl, a.pnl) / a.budget) * 100
        ELSE 0
      END
    ) DESC NULLS LAST
  )::integer                                                        AS rank
FROM public.agents a
JOIN public.profiles p ON p.id = a.user_id
LEFT JOIN trade_stats ts ON ts.agent_id = a.id
LEFT JOIN (
  SELECT agent_id, COUNT(*)::integer AS followers_count
  FROM public.agent_follows
  GROUP BY agent_id
) fc ON fc.agent_id = a.id
WHERE a.is_private = FALSE
  AND a.status IN ('active', 'paused', 'backtesting');

GRANT SELECT ON public.agent_leaderboard TO authenticated, anon;

-- ── 4. rpc_get_portfolio_stats: Bugs 4, 19, 20 ────────────────────────────────
--  Bug  4: Win-rate uses closed sells only (pnl != 0)
--  Bug 19: Best/worst trade ignore buys (pnl = 0)
--  Bug 20: Sharpe computed from per-day realized P&L returns over the
--          portfolio's invested capital (budget). This properly accounts for
--          actual trading returns, not snapshot-value noise.
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
    WHERE a.user_id = p_user_id
  ),
  closed_trades AS (
    -- Trades that actually realized P&L (sells with non-zero pnl, plus shorts)
    SELECT * FROM user_trades
    WHERE side = 'sell' AND pnl IS NOT NULL AND pnl <> 0
      OR (side = 'buy' AND pnl IS NOT NULL AND pnl <> 0)  -- short covers
  ),
  trade_stats AS (
    SELECT
      COUNT(*)                                       AS total_trades,
      COUNT(*) FILTER (WHERE pnl > 0)                AS winning_trades,
      CASE WHEN COUNT(*) > 0
           THEN (COUNT(*) FILTER (WHERE pnl > 0)::numeric / COUNT(*)) * 100
           ELSE 0 END                                AS win_rate,
      COALESCE(SUM(pnl), 0)                          AS total_pnl,
      CASE WHEN COUNT(*) > 0 THEN AVG(pnl) ELSE 0 END AS avg_trade_pnl
    FROM closed_trades
  ),
  active_since_calc AS (
    SELECT MIN(executed_at) AS first_trade FROM user_trades
  ),
  budget_total AS (
    SELECT COALESCE(SUM(budget), 0) AS total_budget
    FROM agents WHERE user_id = p_user_id
  ),
  -- Per-day realized P&L for Sharpe + Max DD
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
    ts.total_trades,
    ts.winning_trades,
    ts.win_rate,
    ts.total_pnl,
    ts.avg_trade_pnl,
    COALESCE((SELECT symbol FROM closed_trades ORDER BY pnl DESC LIMIT 1), '—') AS best_trade_symbol,
    COALESCE((SELECT pnl    FROM closed_trades ORDER BY pnl DESC LIMIT 1), 0)   AS best_trade_pnl,
    COALESCE((SELECT symbol FROM closed_trades ORDER BY pnl ASC  LIMIT 1), '—') AS worst_trade_symbol,
    COALESCE((SELECT pnl    FROM closed_trades ORDER BY pnl ASC  LIMIT 1), 0)   AS worst_trade_pnl,
    asc1.first_trade                                                AS active_since,
    sc.sharpe_ratio,
    md.max_drawdown_pct
  FROM trade_stats ts
  CROSS JOIN active_since_calc asc1
  CROSS JOIN sharpe_calc sc
  CROSS JOIN max_dd md;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_portfolio_stats(uuid) TO authenticated;

-- ── 5. rpc_get_agent_pnl_summary: per-agent realized P&L + position basis ─────
-- Bug 2: agent.pnl in the agents table is only realized. The UI needs
-- (realized + unrealized) per agent. Returns realized + open-position
-- cost basis + open-position quantity per agent, so the client can blend in
-- live unrealized P&L using fetchCurrentPrices().
DROP FUNCTION IF EXISTS rpc_get_agent_pnl_summary(uuid);

CREATE OR REPLACE FUNCTION rpc_get_agent_pnl_summary(p_user_id uuid)
RETURNS TABLE (
  agent_id      uuid,
  symbol        text,
  net_qty       numeric,
  avg_cost      numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH user_trades AS (
    SELECT tr.*
    FROM trades tr
    JOIN agents a ON a.id = tr.agent_id
    WHERE a.user_id = p_user_id
  ),
  buys AS (
    SELECT agent_id, symbol,
           SUM(quantity)             AS qty_bought,
           SUM(price * quantity)     AS cost_basis
    FROM user_trades WHERE side = 'buy'
    GROUP BY agent_id, symbol
  ),
  sells AS (
    SELECT agent_id, symbol, SUM(quantity) AS qty_sold
    FROM user_trades WHERE side = 'sell'
    GROUP BY agent_id, symbol
  )
  SELECT
    b.agent_id,
    b.symbol,
    (b.qty_bought - COALESCE(s.qty_sold, 0))                AS net_qty,
    CASE WHEN b.qty_bought > 0 THEN b.cost_basis / b.qty_bought ELSE 0 END AS avg_cost
  FROM buys b
  LEFT JOIN sells s ON s.agent_id = b.agent_id AND s.symbol = b.symbol
  WHERE ABS(b.qty_bought - COALESCE(s.qty_sold, 0)) > 0.00001;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_agent_pnl_summary(uuid) TO authenticated;

-- ── 6. rpc_get_agent_max_drawdowns: per-agent max DD from trade history ───────
-- Bug 17: agent cards show 0% max DD. Compute from each agent's cumulative
-- realized P&L curve.
DROP FUNCTION IF EXISTS rpc_get_agent_max_drawdowns(uuid);

CREATE OR REPLACE FUNCTION rpc_get_agent_max_drawdowns(p_user_id uuid)
RETURNS TABLE (
  agent_id          uuid,
  max_drawdown_pct  numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH user_trades AS (
    SELECT tr.agent_id, tr.executed_at, tr.pnl, a.budget
    FROM trades tr
    JOIN agents a ON a.id = tr.agent_id
    WHERE a.user_id = p_user_id
      AND tr.pnl IS NOT NULL AND tr.pnl <> 0
  ),
  cumulative AS (
    SELECT
      agent_id,
      budget,
      executed_at,
      SUM(pnl) OVER (PARTITION BY agent_id ORDER BY executed_at) AS cum_pnl
    FROM user_trades
  ),
  with_peak AS (
    SELECT
      agent_id,
      budget,
      cum_pnl,
      MAX(cum_pnl) OVER (PARTITION BY agent_id ORDER BY executed_at
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak
    FROM cumulative
  ),
  dd AS (
    SELECT
      agent_id,
      CASE WHEN (budget + peak) > 0
           THEN ((peak - cum_pnl) / (budget + peak)) * 100
           ELSE 0 END AS drawdown_pct
    FROM with_peak
  )
  SELECT agent_id, COALESCE(MAX(drawdown_pct), 0) AS max_drawdown_pct
  FROM dd
  GROUP BY agent_id;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_agent_max_drawdowns(uuid) TO authenticated;

-- ── 7. rpc_get_agent_pnl_history: per-agent daily cumulative P&L (Bug 16) ─────
-- For agent card sparklines. Returns last 30 days of cumulative P&L per agent.
DROP FUNCTION IF EXISTS rpc_get_agent_pnl_history(uuid, int);

CREATE OR REPLACE FUNCTION rpc_get_agent_pnl_history(
  p_user_id uuid,
  p_days    int DEFAULT 30
)
RETURNS TABLE (
  agent_id  uuid,
  d         date,
  cum_pnl   numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH user_trades AS (
    SELECT tr.agent_id, DATE(tr.executed_at) AS d, tr.pnl
    FROM trades tr
    JOIN agents a ON a.id = tr.agent_id
    WHERE a.user_id = p_user_id
      AND tr.executed_at >= (CURRENT_DATE - p_days)
  ),
  daily AS (
    SELECT agent_id, d, COALESCE(SUM(pnl), 0) AS day_pnl
    FROM user_trades
    GROUP BY agent_id, d
  )
  SELECT
    agent_id,
    d,
    SUM(day_pnl) OVER (PARTITION BY agent_id ORDER BY d) AS cum_pnl
  FROM daily
  ORDER BY agent_id, d;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_agent_pnl_history(uuid, int) TO authenticated;
