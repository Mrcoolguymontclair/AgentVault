-- ─────────────────────────────────────────────────────────────
-- 009_security_fixes.sql
-- Resolves all Supabase security linter warnings:
--   1. leaderboard_view / agent_leaderboard → security_invoker
--   2. groq_usage → enable RLS
--   3. 5 Groq RPCs → add SET search_path = public
--   4. set_updated_at → add SET search_path = public
--   5. agent_logs INSERT policy → drop unrestricted WITH CHECK (true)
-- NOTE: "Leaked Password Protection" must be enabled manually in the
--       Supabase Dashboard → Authentication → Settings → Password Protection.
-- Run this in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────


-- ── 1. Views: switch to security_invoker ─────────────────────
-- By default views run as their owner (security definer behaviour).
-- security_invoker = true makes them run as the querying user so
-- RLS on the underlying tables (agents, profiles, agent_follows) applies.
ALTER VIEW public.leaderboard_view  SET (security_invoker = true);
ALTER VIEW public.agent_leaderboard SET (security_invoker = true);


-- ── 2. groq_usage: enable RLS ────────────────────────────────
-- All client-facing reads go through SECURITY DEFINER RPCs which
-- bypass RLS. The Edge Function uses service_role which also bypasses
-- RLS. No additional policies are needed.
ALTER TABLE public.groq_usage ENABLE ROW LEVEL SECURITY;


-- ── 3. Groq RPCs: pin search_path ────────────────────────────
-- Without SET search_path = public a malicious user could shadow
-- public functions via a search_path injection attack.

CREATE OR REPLACE FUNCTION public.rpc_log_groq_usage(
  p_tokens_used  int,
  p_request_type text,
  p_agent_id     text    default null,
  p_api_key_used text    default 'primary'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO groq_usage (tokens_used, request_type, agent_id, api_key_used)
  VALUES (p_tokens_used, p_request_type, p_agent_id, p_api_key_used);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_groq_usage_today()
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(tokens_used), 0)::int
  FROM   groq_usage
  WHERE  created_at >= current_date::timestamptz;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_groq_stats_today()
RETURNS json
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT json_build_object(
    'tokens_used',       coalesce(sum(tokens_used), 0),
    'request_count',     count(*)::int,
    'primary_requests',  count(*) filter (where api_key_used = 'primary')::int,
    'backup_requests',   count(*) filter (where api_key_used = 'backup')::int
  )
  FROM groq_usage
  WHERE created_at >= current_date::timestamptz;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_groq_usage_history()
RETURNS TABLE(hour_start text, tokens_used bigint, request_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    to_char(hour_bucket AT TIME ZONE 'America/New_York', 'HH24:MI') AS hour_start,
    sum(tokens_used)  AS tokens_used,
    count(*)          AS request_count
  FROM (
    SELECT
      date_trunc('hour', created_at) AS hour_bucket,
      tokens_used
    FROM groq_usage
    WHERE created_at >= now() - interval '24 hours'
  ) sub
  GROUP BY hour_bucket
  ORDER BY hour_bucket;
$$;

CREATE OR REPLACE FUNCTION public.rpc_cleanup_groq_usage()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE deleted_count int;
BEGIN
  DELETE FROM groq_usage WHERE created_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Re-apply grants (idempotent — safe to run again)
GRANT EXECUTE ON FUNCTION public.rpc_get_groq_stats_today()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_groq_usage_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cleanup_groq_usage()     TO authenticated;


-- ── 4. set_updated_at: pin search_path ───────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ── 5. agent_logs INSERT policy: remove unrestricted access ──
-- The policy "Service role can insert logs" used WITH CHECK (true),
-- which allowed any role (including anon/authenticated) to INSERT rows
-- directly into agent_logs. The Edge Function uses service_role, which
-- bypasses RLS entirely, so this open policy is unnecessary.
DROP POLICY IF EXISTS "Service role can insert logs" ON public.agent_logs;
-- SELECT policy for owners is untouched — users can still read their own logs.
