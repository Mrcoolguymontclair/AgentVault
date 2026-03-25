-- 021_fix_historical_pnl.sql
-- Recalculates realized P&L for all sell trades that have pnl = 0.
-- The original bug (pnl = (fillPrice - fillPrice) * qty = 0) caused every
-- sell to record $0 P&L.  This migration computes correct realized P&L using
-- the FIFO avg-cost method and updates the trades + agent stats tables.

-- ── Step 1: Recalculate sell trade P&L via FIFO avg-cost ──────────────────────
DO $$
DECLARE
  rec         RECORD;
  avg_cost    NUMERIC;
  trade_pnl   NUMERIC;
BEGIN
  -- Process each agent independently
  FOR rec IN (SELECT DISTINCT agent_id FROM trades ORDER BY agent_id) LOOP
    DECLARE
      sym_rec        RECORD;
      sym_avg_cost   NUMERIC := 0;
      sym_qty        NUMERIC := 0;
    BEGIN
      -- Re-process all trades in chronological order, per symbol, per agent
      FOR sym_rec IN (
        SELECT DISTINCT symbol FROM trades WHERE agent_id = rec.agent_id
      ) LOOP
        sym_avg_cost := 0;
        sym_qty      := 0;

        FOR avg_cost IN (
          -- Use a cursor-style: iterate trades in order
          SELECT 1
        ) LOOP
          EXIT; -- dummy loop just to declare inner block
        END LOOP;

        -- Process each trade for this agent+symbol in order
        DECLARE
          t RECORD;
        BEGIN
          FOR t IN (
            SELECT id, side, quantity, price, pnl
            FROM trades
            WHERE agent_id = rec.agent_id AND symbol = sym_rec.symbol
            ORDER BY executed_at ASC
          ) LOOP
            IF t.side = 'buy' THEN
              -- Update rolling average cost
              IF sym_qty + t.quantity > 0 THEN
                sym_avg_cost := (sym_avg_cost * sym_qty + t.price * t.quantity)
                                / (sym_qty + t.quantity);
              END IF;
              sym_qty := sym_qty + t.quantity;
            ELSIF t.side = 'sell' THEN
              -- Only fix trades where pnl is 0 AND we have a valid avg_cost
              IF t.pnl = 0 AND sym_avg_cost > 0 AND sym_qty > 0 THEN
                trade_pnl := (t.price - sym_avg_cost) * t.quantity;
                UPDATE trades SET pnl = trade_pnl WHERE id = t.id;
              END IF;
              sym_qty := GREATEST(sym_qty - t.quantity, 0);
            END IF;
          END LOOP;
        END;
      END LOOP;
    END;
  END LOOP;
END;
$$;

-- ── Step 2: Refresh agent stats for all agents ────────────────────────────────
DO $$
DECLARE
  a RECORD;
  v_budget       NUMERIC;
  v_pnl          NUMERIC;
  v_pnl_pct      NUMERIC;
  v_trades_count BIGINT;
  v_win_rate     NUMERIC;
  v_sell_total   BIGINT;
  v_sell_wins    BIGINT;
BEGIN
  FOR a IN (SELECT id FROM agents WHERE status != 'stopped') LOOP
    SELECT COALESCE(budget, 1000) INTO v_budget FROM agents WHERE id = a.id;

    SELECT COALESCE(SUM(pnl), 0), COUNT(*)
    INTO v_pnl, v_trades_count
    FROM trades WHERE agent_id = a.id;

    SELECT
      COUNT(*) FILTER (WHERE side = 'sell'),
      COUNT(*) FILTER (WHERE side = 'sell' AND pnl > 0)
    INTO v_sell_total, v_sell_wins
    FROM trades WHERE agent_id = a.id;

    v_win_rate := CASE WHEN v_sell_total > 0
                       THEN (v_sell_wins::NUMERIC / v_sell_total) * 100
                       ELSE 0 END;
    v_pnl_pct  := CASE WHEN v_budget > 0 THEN (v_pnl / v_budget) * 100 ELSE 0 END;

    UPDATE agents SET
      pnl          = v_pnl,
      pnl_pct      = v_pnl_pct,
      trades_count = v_trades_count,
      win_rate     = v_win_rate,
      updated_at   = now()
    WHERE id = a.id;
  END LOOP;
END;
$$;
