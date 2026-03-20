-- ─────────────────────────────────────────────────────────────────────────────
-- 014_order_tracking.sql
--
-- 1. alpaca_order_id + order_status columns on trades
-- 2. rpc_get_portfolio_snapshots — powers the portfolio chart
-- 3. rpc_update_agent_stats     — recalculates and persists agent KPIs
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Order tracking columns ─────────────────────────────────────────────────
ALTER TABLE trades ADD COLUMN IF NOT EXISTS alpaca_order_id TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_status    TEXT DEFAULT 'filled';

CREATE INDEX IF NOT EXISTS idx_trades_alpaca_order_id
  ON trades (alpaca_order_id)
  WHERE alpaca_order_id IS NOT NULL;

-- ── 2. Portfolio snapshot reader ──────────────────────────────────────────────
-- Called by portfolioService.ts → fetchPortfolioSnapshots()
-- Aggregates per-agent daily snapshots into a single daily total for the chart.
DROP FUNCTION IF EXISTS rpc_get_portfolio_snapshots(uuid, text);
DROP FUNCTION IF EXISTS rpc_get_portfolio_snapshots(uuid, date);

CREATE OR REPLACE FUNCTION rpc_get_portfolio_snapshots(
  p_user_id uuid,
  p_since    text   -- "YYYY-MM-DD"  (sent as text from supabase-js)
)
RETURNS TABLE (
  snapshot_date date,
  value         numeric,
  pnl_pct       numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ps.snapshot_date,
    SUM(ps.value)   AS value,
    AVG(ps.pnl_pct) AS pnl_pct
  FROM portfolio_snapshots ps
  WHERE ps.user_id = p_user_id
    AND ps.snapshot_date >= p_since::date
  GROUP BY ps.snapshot_date
  ORDER BY ps.snapshot_date ASC;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_portfolio_snapshots(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_portfolio_snapshots(uuid, text) TO service_role;

-- ── 3. Agent stats recalculator ───────────────────────────────────────────────
-- Called from the Edge Function after every trade.
-- Recalculates pnl, pnl_pct, trades_count, win_rate from the trades table.
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
  v_sell_total   bigint;
  v_sell_wins    bigint;
BEGIN
  SELECT COALESCE(budget, 1000) INTO v_budget
  FROM agents WHERE id = p_agent_id;

  SELECT
    COALESCE(SUM(pnl), 0),
    COUNT(*)
  INTO v_pnl, v_trades_count
  FROM trades
  WHERE agent_id = p_agent_id;

  SELECT
    COUNT(*) FILTER (WHERE side = 'sell'),
    COUNT(*) FILTER (WHERE side = 'sell' AND pnl > 0)
  INTO v_sell_total, v_sell_wins
  FROM trades
  WHERE agent_id = p_agent_id;

  v_win_rate := CASE WHEN v_sell_total > 0
                     THEN (v_sell_wins::numeric / v_sell_total) * 100
                     ELSE 0 END;

  v_pnl_pct := CASE WHEN v_budget > 0 THEN (v_pnl / v_budget) * 100 ELSE 0 END;

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

GRANT EXECUTE ON FUNCTION rpc_update_agent_stats(uuid) TO service_role;
