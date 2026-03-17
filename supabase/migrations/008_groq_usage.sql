-- ─────────────────────────────────────────────────────────────
-- 008_groq_usage.sql
-- Groq API usage tracking: per-call logging, daily budgets,
-- hourly history for the debug dashboard.
-- Run this in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────

-- ── Table ────────────────────────────────────────────────────
create table if not exists groq_usage (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null    default now(),
  tokens_used   int         not null    default 0,
  request_type  text        not null    default 'confirm_trade'
                  check (request_type in ('confirm_trade', 'sentiment', 'mispricing', 'custom')),
  agent_id      text,
  api_key_used  text        not null    default 'primary'
                  check (api_key_used in ('primary', 'backup'))
);

create index if not exists groq_usage_created_at_idx on groq_usage (created_at);

-- ── RPCs ─────────────────────────────────────────────────────

-- Called from Edge Function (service role) to record each Groq call.
create or replace function rpc_log_groq_usage(
  p_tokens_used  int,
  p_request_type text,
  p_agent_id     text    default null,
  p_api_key_used text    default 'primary'
) returns void
language plpgsql security definer as $$
begin
  insert into groq_usage (tokens_used, request_type, agent_id, api_key_used)
  values (p_tokens_used, p_request_type, p_agent_id, p_api_key_used);
end;
$$;

-- Called from Edge Function at startup to initialize the daily budget tracker.
create or replace function rpc_get_groq_usage_today()
returns int
language sql security definer as $$
  select coalesce(sum(tokens_used), 0)::int
  from   groq_usage
  where  created_at >= current_date::timestamptz;
$$;

-- Called from debug dashboard: full today stats.
create or replace function rpc_get_groq_stats_today()
returns json
language sql security definer as $$
  select json_build_object(
    'tokens_used',       coalesce(sum(tokens_used), 0),
    'request_count',     count(*)::int,
    'primary_requests',  count(*) filter (where api_key_used = 'primary')::int,
    'backup_requests',   count(*) filter (where api_key_used = 'backup')::int
  )
  from groq_usage
  where created_at >= current_date::timestamptz;
$$;

-- Called from debug dashboard: hourly token usage over the last 24 hours.
create or replace function rpc_get_groq_usage_history()
returns table(hour_start text, tokens_used bigint, request_count bigint)
language sql security definer as $$
  select
    to_char(hour_bucket at time zone 'America/New_York', 'HH24:MI') as hour_start,
    sum(tokens_used)  as tokens_used,
    count(*)          as request_count
  from (
    select
      date_trunc('hour', created_at) as hour_bucket,
      tokens_used
    from groq_usage
    where created_at >= now() - interval '24 hours'
  ) sub
  group by hour_bucket
  order by hour_bucket;
$$;

-- Optional: removes records older than 7 days (call from debug screen or schedule).
create or replace function rpc_cleanup_groq_usage()
returns int
language plpgsql security definer as $$
declare deleted_count int;
begin
  delete from groq_usage where created_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Grant execute to authenticated users so the debug dashboard can call them.
grant execute on function rpc_get_groq_stats_today()    to authenticated;
grant execute on function rpc_get_groq_usage_history()  to authenticated;
grant execute on function rpc_cleanup_groq_usage()      to authenticated;
-- rpc_log_groq_usage and rpc_get_groq_usage_today are service-role only (Edge Function).
