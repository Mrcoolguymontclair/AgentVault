-- ─────────────────────────────────────────────────────────────
-- 010_fix_leaderboard_rls.sql
-- After migration 009 set security_invoker = true on agent_leaderboard,
-- the view now runs with the calling user's privileges. This means the
-- RLS policies on public.agents apply — and there was no policy allowing
-- authenticated users to SELECT other users' public agents.
--
-- Fix: add explicit SELECT policies for public agents on the agents table.
-- Run this in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────

-- Allow authenticated users to read any public agent (is_private = FALSE)
DROP POLICY IF EXISTS "Public agents viewable by authenticated" ON public.agents;
CREATE POLICY "Public agents viewable by authenticated"
  ON public.agents FOR SELECT
  TO authenticated
  USING (is_private = FALSE);

-- Allow anon access too (for leaderboard embeds / unauthenticated views)
DROP POLICY IF EXISTS "Public agents viewable by anon" ON public.agents;
CREATE POLICY "Public agents viewable by anon"
  ON public.agents FOR SELECT
  TO anon
  USING (is_private = FALSE);
