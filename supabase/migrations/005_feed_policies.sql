-- ============================================================
-- AgentVault — Social Feed Policies
-- Allows reading trades from public agents (for social feed)
-- and enables Realtime on trades + comments tables
-- ============================================================

-- Allow any authenticated user to read trades that belong to a public agent
CREATE POLICY "trades_select_public_agents"
  ON public.trades FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = trades.agent_id
        AND a.is_private = FALSE
    )
  );

-- Enable Realtime publication for trades + comments
-- (agents + profiles were added in 001, this ensures trades is covered)
ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
