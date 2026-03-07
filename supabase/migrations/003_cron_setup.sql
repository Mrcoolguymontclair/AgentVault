-- ============================================================
-- AgentVault — Cron Schedule for run-agents Edge Function
-- Run this in the Supabase SQL Editor AFTER deploying the
-- run-agents edge function.
--
-- Project ref: YOUR_SUPABASE_PROJECT_ID
-- Edge function URL: https://YOUR_SUPABASE_PROJECT_ID.supabase.co/functions/v1/run-agents
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any existing schedule before creating a new one
SELECT cron.unschedule('run-agents-market-hours')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'run-agents-market-hours'
);

-- Schedule: every 5 minutes, Mon–Fri, 14:00–20:59 UTC
-- That covers 9:00 AM–4:59 PM ET (EST offset; edge function checks precise open time)
SELECT cron.schedule(
  'run-agents-market-hours',
  '*/5 14-20 * * 1-5',
  $$
  SELECT net.http_post(
    url     := 'https://YOUR_SUPABASE_PROJECT_ID.supabase.co/functions/v1/run-agents',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Verify the schedule was created
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'run-agents-market-hours';
