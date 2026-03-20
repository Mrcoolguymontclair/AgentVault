-- Add Alpaca order tracking fields to trades table
-- Enables order reconciliation, fill verification, and rejection handling

ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_status TEXT DEFAULT 'simulated';

-- Index for looking up trades by Alpaca order ID
CREATE INDEX IF NOT EXISTS idx_trades_order_id ON trades (order_id) WHERE order_id IS NOT NULL;

COMMENT ON COLUMN trades.order_id IS 'Alpaca broker order ID for reconciliation';
COMMENT ON COLUMN trades.order_status IS 'Order status: accepted, filled, partially_filled, rejected, simulated';
