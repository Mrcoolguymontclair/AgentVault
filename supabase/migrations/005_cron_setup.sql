-- ─────────────────────────────────────────────────────────────────────────────
-- 005_cron_setup.sql
-- Automates agent execution every 15 minutes during US market hours
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable required extensions
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Remove any previously scheduled job with this name (idempotent)
select cron.unschedule('run-agents-market-hours')
  where exists (
    select 1 from cron.job where jobname = 'run-agents-market-hours'
  );

-- Schedule: every 15 minutes, Mon–Fri, 14:00–20:00 UTC (= 9 AM–4 PM ET)
select cron.schedule(
  'run-agents-market-hours',
  '*/15 14-20 * * 1-5',
  $$
  select net.http_post(
    url     => 'https://YOUR_SUPABASE_PROJECT_ID.supabase.co/functions/v1/run-agents',
    headers => jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
               ),
    body    => '{"force": true}'::jsonb,
    timeout_milliseconds => 55000
  );
  $$
);
