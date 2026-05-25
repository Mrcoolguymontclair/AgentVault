-- 023_sell_pnl_fix.sql
-- Fixes sell pnl = 0 by providing a SQL source of truth for avg cost,
-- an RPC-based trade insert, and a backfill of all historical $0 sell rows.

-- ── a. rpc_get_agent_avg_cost ─────────────────────────────────────────────────
-- Weighted avg cost from BUY trades only. Returns NULL (not 0) when no buys.
DROP FUNCTION IF EXISTS rpc_get_agent_avg_cost(uuid, text);

CREATE OR REPLACE FUNCTION rpc_get_agent_avg_cost(
  p_agent_id uuid,
  p_symbol   text
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT SUM(price * quantity) / NULLIF(SUM(quantity), 0)
  FROM trades
  WHERE agent_id = p_agent_id
    AND symbol   = p_symbol
    AND side     = 'buy';
$$;

GRANT EXECUTE ON FUNCTION rpc_get_agent_avg_cost(uuid, text) TO authenticated, service_role;

-- ── b. rpc_insert_trade ───────────────────────────────────────────────────────
-- Single RPC for trade inserts. Handles nullable alpaca_order_id / order_status.
DROP FUNCTION IF EXISTS rpc_insert_trade(uuid, uuid, text, trade_side, numeric, numeric, numeric, text, text);

CREATE OR REPLACE FUNCTION rpc_insert_trade(
  p_agent_id        uuid,
  p_user_id         uuid,
  p_symbol          text,
  p_side            trade_side,
  p_quantity        numeric,
  p_price           numeric,
  p_pnl             numeric,
  p_alpaca_order_id text    DEFAULT NULL,
  p_order_status    text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO trades (
    agent_id,
    user_id,
    symbol,
    side,
    quantity,
    price,
    pnl,
    alpaca_order_id,
    order_status,
    executed_at
  ) VALUES (
    p_agent_id,
    p_user_id,
    p_symbol,
    p_side,
    p_quantity,
    p_price,
    p_pnl,
    p_alpaca_order_id,
    p_order_status,
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_insert_trade(uuid, uuid, text, trade_side, numeric, numeric, numeric, text, text)
  TO authenticated, service_role;

-- ── c. Backfill all $0 sell rows ──────────────────────────────────────────────
DO $$
DECLARE
  rec             RECORD;
  sym_rec         RECORD;
  t               RECORD;
  sym_avg_cost    NUMERIC;
  sym_qty         NUMERIC;
  trade_pnl       NUMERIC;
  updated_agents  uuid[] := '{}';
  v_agent_id      uuid;
BEGIN
  -- Process each agent independently
  FOR rec IN (
    SELECT DISTINCT agent_id
    FROM trades
    WHERE side = 'sell' AND pnl = 0
    ORDER BY agent_id
  ) LOOP
    BEGIN
      -- For each symbol this agent traded
      FOR sym_rec IN (
        SELECT DISTINCT symbol
        FROM trades
        WHERE agent_id = rec.agent_id
      ) LOOP
        sym_avg_cost := 0;
        sym_qty      := 0;

        -- Walk trades in chronological order, FIFO weighted-avg
        FOR t IN (
          SELECT id, side, quantity, price, pnl
          FROM trades
          WHERE agent_id = rec.agent_id AND symbol = sym_rec.symbol
          ORDER BY executed_at ASC
        ) LOOP
          IF t.side = 'buy' THEN
            IF sym_qty + t.quantity > 0 THEN
              sym_avg_cost := (sym_avg_cost * sym_qty + t.price * t.quantity)
                              / (sym_qty + t.quantity);
            END IF;
            sym_qty := sym_qty + t.quantity;

          ELSIF t.side = 'sell' THEN
            IF t.pnl = 0 AND sym_avg_cost > 0 AND sym_qty > 0 THEN
              trade_pnl := (t.price - sym_avg_cost) * t.quantity;
              UPDATE trades SET pnl = trade_pnl WHERE id = t.id;
            END IF;
            sym_qty := GREATEST(sym_qty - t.quantity, 0);
          END IF;
        END LOOP;
      END LOOP;

      -- Track which agents had rows updated
      updated_agents := array_append(updated_agents, rec.agent_id);

    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Backfill skipped for agent %: %', rec.agent_id, SQLERRM;
    END;
  END LOOP;

  -- Refresh stats for every affected agent
  FOREACH v_agent_id IN ARRAY updated_agents LOOP
    BEGIN
      PERFORM rpc_update_agent_stats(v_agent_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'rpc_update_agent_stats failed for agent %: %', v_agent_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
