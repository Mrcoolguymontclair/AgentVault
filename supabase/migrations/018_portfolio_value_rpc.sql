-- ─────────────────────────────────────────────────────────────────────────────
-- 018_portfolio_value_rpc.sql
-- Keeps profiles.balance in sync with actual realized P&L after every trade.
-- Called by the run-agents edge function (service_role) after each trade.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_calculate_portfolio_value(p_user_id uuid)
RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET
    balance    = 10000.00 + COALESCE((SELECT SUM(pnl) FROM trades WHERE user_id = p_user_id), 0),
    updated_at = now()
  WHERE id = p_user_id
  RETURNING balance;
$$;

-- Only callable from service_role (edge functions). Never expose to authenticated.
GRANT EXECUTE ON FUNCTION rpc_calculate_portfolio_value(uuid) TO service_role;
