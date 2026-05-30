-- ============================================================================
-- Migration 025 · Seal orphan short positions (BUG-002)
-- ============================================================================
-- WHAT:  Every (agent_id, symbol) whose lifetime net quantity
--          SUM(buy.qty) - SUM(sell.qty)  is NEGATIVE is a leftover short from
--        the pre-overhaul shorts era that was never covered in the trades
--        table. The holdings RPC reads net qty < 0 as an open SHORT, inflating
--        the Holdings view (e.g. "39 positions") far past the ~7 real longs.
--
-- HOW:   For each negative-net symbol, insert ONE synthetic 'buy' of exactly
--        ABS(net) shares at the most-recent sell price, pnl=0, executed one
--        second after that last sell, order_status='synthetic-seal'. This
--        zeroes the net position without touching realized P&L (already booked
--        on the historical cover rows).
--
-- WHY SET-BASED (not a chronological walk): netting the lifetime position in a
--        single GROUP BY is correct for interleaved buy/sell sequences (CCL,
--        USO, LCID, ...). A per-row "walk and seal each short-open excess"
--        approach OVER-inserts on those symbols. We only care about the final
--        net, so one synthetic buy per negative symbol is exact.
--
-- REVERSAL:  DELETE FROM trades WHERE order_status = 'synthetic-seal';
--            (then re-run rpc_update_agent_stats per affected agent)
-- ============================================================================

-- 1) Seal every orphan short with a single synthetic cover buy.
WITH negatives AS (
  SELECT agent_id, user_id, symbol,
    ABS(SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END)) AS synthetic_qty
  FROM trades
  GROUP BY agent_id, user_id, symbol
  HAVING SUM(CASE WHEN side = 'buy' THEN quantity ELSE -quantity END) < 0
),
last_sell AS (
  SELECT DISTINCT ON (agent_id, symbol)
    agent_id, symbol, price, executed_at
  FROM trades
  WHERE side = 'sell'
  ORDER BY agent_id, symbol, executed_at DESC
)
INSERT INTO trades (agent_id, user_id, symbol, side, quantity, price, pnl, executed_at, order_status)
SELECT
  n.agent_id, n.user_id, n.symbol,
  'buy'::trade_side, n.synthetic_qty, ls.price, 0,
  ls.executed_at + interval '1 second', 'synthetic-seal'
FROM negatives n
JOIN last_sell ls ON ls.agent_id = n.agent_id AND ls.symbol = n.symbol;

-- 2) Refresh stats for every agent we touched.
DO $$
DECLARE
  aid uuid;
BEGIN
  FOR aid IN
    SELECT DISTINCT agent_id FROM trades WHERE order_status = 'synthetic-seal'
  LOOP
    PERFORM rpc_update_agent_stats(aid);
  END LOOP;
END $$;
