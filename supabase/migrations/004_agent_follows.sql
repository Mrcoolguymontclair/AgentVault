-- ============================================================
-- AgentVault — Agent Follows + Agent Leaderboard View
-- ============================================================

-- Agent-specific follows (user follows an agent, not just a trader)
CREATE TABLE IF NOT EXISTS public.agent_follows (
  follower_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id)   ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_follows_agent_id    ON public.agent_follows (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_follows_follower_id ON public.agent_follows (follower_id);

ALTER TABLE public.agent_follows ENABLE ROW LEVEL SECURITY;

-- Users manage their own follows; anyone can read follow counts
CREATE POLICY "agent_follows_manage_own"
  ON public.agent_follows FOR ALL
  USING (auth.uid() = follower_id);

CREATE POLICY "agent_follows_read_all"
  ON public.agent_follows FOR SELECT
  USING (true);

-- ──────────────────────────────────────────────────────────────
-- Agent leaderboard view (auto-refreshes, unlike materialized)
-- Ranks all public, non-stopped agents by all-time return %
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.agent_leaderboard AS
SELECT
  a.id,
  a.name,
  a.strategy,
  a.config,
  a.pnl,
  a.pnl_pct,
  a.win_rate,
  a.trades_count,
  a.budget,
  a.mode,
  a.status,
  a.user_id,
  p.display_name,
  p.avatar,
  COALESCE(fc.followers_count, 0)::integer AS followers_count,
  RANK() OVER (ORDER BY a.pnl_pct DESC NULLS LAST)::integer AS rank
FROM public.agents a
JOIN public.profiles p ON p.id = a.user_id
LEFT JOIN (
  SELECT agent_id, COUNT(*)::integer AS followers_count
  FROM public.agent_follows
  GROUP BY agent_id
) fc ON fc.agent_id = a.id
WHERE a.is_private = FALSE
  AND a.status IN ('active', 'paused', 'backtesting');

-- Allow all authenticated users to read the leaderboard view
GRANT SELECT ON public.agent_leaderboard TO authenticated, anon;
