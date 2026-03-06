-- ============================================================
-- AgentVault — Initial Schema
-- Paste this entire file into Supabase SQL Editor and click Run
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. EXTENSIONS
-- ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ──────────────────────────────────────────────────────────────
-- 2. ENUMS
-- ──────────────────────────────────────────────────────────────
do $$ begin
  create type agent_status as enum ('active', 'paused', 'stopped', 'backtesting');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_mode as enum ('paper', 'live');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trade_side as enum ('buy', 'sell');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_plan as enum ('free', 'pro', 'elite');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('active', 'cancelled', 'expired', 'trial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type trading_level as enum ('beginner', 'intermediate', 'advanced', 'professional');
exception when duplicate_object then null; end $$;

-- ──────────────────────────────────────────────────────────────
-- 3. TABLES
-- ──────────────────────────────────────────────────────────────

-- 3a. profiles — one row per auth user
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text not null default '',
  avatar            text not null default '🚀',
  trading_level     trading_level not null default 'beginner',
  plan              subscription_plan not null default 'free',
  balance           numeric(14,2) not null default 10000.00,
  total_return_pct  numeric(8,4) not null default 0,
  win_rate          numeric(5,2) not null default 0,
  rank              integer,
  active_agents     integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 3b. agents — AI trading agents per user
create table if not exists public.agents (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  strategy        text not null,
  description     text not null default '',
  status          agent_status not null default 'backtesting',
  mode            agent_mode not null default 'paper',
  pnl             numeric(14,2) not null default 0,
  pnl_pct         numeric(8,4) not null default 0,
  trades_count    integer not null default 0,
  win_rate        numeric(5,2) not null default 0,
  max_drawdown    numeric(5,2) not null default 0,
  sharpe_ratio    numeric(6,3) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 3c. trades — individual trades executed by agents
create table if not exists public.trades (
  id           uuid primary key default uuid_generate_v4(),
  agent_id     uuid not null references public.agents(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  symbol       text not null,
  side         trade_side not null,
  quantity     numeric(18,8) not null,
  price        numeric(14,4) not null,
  pnl          numeric(14,2) not null default 0,
  executed_at  timestamptz not null default now()
);

-- 3d. portfolio_snapshots — daily portfolio value per agent
create table if not exists public.portfolio_snapshots (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  agent_id       uuid references public.agents(id) on delete set null,
  value          numeric(14,2) not null,
  pnl_pct        numeric(8,4) not null default 0,
  snapshot_date  date not null default current_date,
  created_at     timestamptz not null default now(),
  unique(user_id, agent_id, snapshot_date)
);

-- 3e. follows — social graph
create table if not exists public.follows (
  follower_id   uuid not null references public.profiles(id) on delete cascade,
  following_id  uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

-- 3f. comments — social posts/comments on agents
create table if not exists public.comments (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  agent_id    uuid references public.agents(id) on delete set null,
  content     text not null,
  likes       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3g. subscriptions — billing / plan management
create table if not exists public.subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  plan        subscription_plan not null default 'free',
  status      subscription_status not null default 'active',
  period_end  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────
-- 4. INDEXES
-- ──────────────────────────────────────────────────────────────
create index if not exists idx_agents_user_id          on public.agents(user_id);
create index if not exists idx_agents_status           on public.agents(status);
create index if not exists idx_trades_agent_id         on public.trades(agent_id);
create index if not exists idx_trades_executed_at      on public.trades(executed_at desc);
create index if not exists idx_trades_user_id          on public.trades(user_id);
create index if not exists idx_follows_following_id    on public.follows(following_id);
create index if not exists idx_follows_follower_id     on public.follows(follower_id);
create index if not exists idx_snapshots_agent_id      on public.portfolio_snapshots(agent_id);
create index if not exists idx_snapshots_date          on public.portfolio_snapshots(snapshot_date desc);
create index if not exists idx_comments_agent_id       on public.comments(agent_id);
create index if not exists idx_comments_user_id        on public.comments(user_id);
create index if not exists idx_subscriptions_user_id   on public.subscriptions(user_id);

-- ──────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.agents            enable row level security;
alter table public.trades            enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.follows           enable row level security;
alter table public.comments          enable row level security;
alter table public.subscriptions     enable row level security;

-- profiles
create policy "profiles_select_all"  on public.profiles for select using (true);
create policy "profiles_insert_own"  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own"  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- agents
create policy "agents_select_all"    on public.agents for select using (true);
create policy "agents_insert_own"    on public.agents for insert with check (auth.uid() = user_id);
create policy "agents_update_own"    on public.agents for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "agents_delete_own"    on public.agents for delete using (auth.uid() = user_id);

-- trades
create policy "trades_select_own"    on public.trades for select using (auth.uid() = user_id);
create policy "trades_insert_own"    on public.trades for insert with check (auth.uid() = user_id);

-- portfolio_snapshots
create policy "snapshots_select_own" on public.portfolio_snapshots for select using (auth.uid() = user_id);
create policy "snapshots_insert_own" on public.portfolio_snapshots for insert with check (auth.uid() = user_id);
create policy "snapshots_update_own" on public.portfolio_snapshots for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- follows
create policy "follows_select_all"   on public.follows for select using (true);
create policy "follows_insert_own"   on public.follows for insert with check (auth.uid() = follower_id);
create policy "follows_delete_own"   on public.follows for delete using (auth.uid() = follower_id);

-- comments
create policy "comments_select_all"  on public.comments for select using (true);
create policy "comments_insert_own"  on public.comments for insert with check (auth.uid() = user_id);
create policy "comments_update_own"  on public.comments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "comments_delete_own"  on public.comments for delete using (auth.uid() = user_id);

-- subscriptions
create policy "subscriptions_select_own" on public.subscriptions for select using (auth.uid() = user_id);
create policy "subscriptions_insert_own" on public.subscriptions for insert with check (auth.uid() = user_id);
create policy "subscriptions_update_own" on public.subscriptions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────
-- 6. TRIGGER: Auto-create profile on signup
-- ──────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar, trading_level)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    coalesce(new.raw_user_meta_data->>'avatar', '🚀'),
    coalesce(
      (new.raw_user_meta_data->>'trading_level')::trading_level,
      'beginner'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ──────────────────────────────────────────────────────────────
-- 7. TRIGGER: Keep updated_at current
-- ──────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at    before update on public.profiles    for each row execute procedure public.set_updated_at();
create trigger agents_updated_at      before update on public.agents      for each row execute procedure public.set_updated_at();
create trigger comments_updated_at    before update on public.comments    for each row execute procedure public.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute procedure public.set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- 8. FUNCTION: calculate_agent_pnl
--    Recalculates pnl, win_rate, trades_count for an agent
--    from the trades table and updates the agents row.
-- ──────────────────────────────────────────────────────────────
create or replace function public.calculate_agent_pnl(p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_pnl   numeric(14,2);
  v_total_trades integer;
  v_winning     integer;
  v_win_rate    numeric(5,2);
begin
  select
    coalesce(sum(pnl), 0),
    count(*)::integer,
    count(*) filter (where pnl > 0)::integer
  into v_total_pnl, v_total_trades, v_winning
  from public.trades
  where agent_id = p_agent_id;

  if v_total_trades > 0 then
    v_win_rate := round((v_winning::numeric / v_total_trades) * 100, 2);
  else
    v_win_rate := 0;
  end if;

  update public.agents
  set
    pnl          = v_total_pnl,
    trades_count = v_total_trades,
    win_rate     = v_win_rate,
    updated_at   = now()
  where id = p_agent_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 9. FUNCTION: get_daily_pnl
--    Returns daily P&L totals for a user over the last N days.
-- ──────────────────────────────────────────────────────────────
create or replace function public.get_daily_pnl(p_user_id uuid, p_days integer default 30)
returns table (
  trade_date  date,
  daily_pnl   numeric(14,2),
  trade_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    executed_at::date                    as trade_date,
    coalesce(sum(pnl), 0)::numeric(14,2) as daily_pnl,
    count(*)::integer                    as trade_count
  from public.trades
  where
    user_id    = p_user_id
    and executed_at >= now() - (p_days || ' days')::interval
  group by executed_at::date
  order by trade_date asc;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 10. MATERIALIZED VIEW: leaderboard_view
--     Aggregates top traders ranked by total agent P&L.
-- ──────────────────────────────────────────────────────────────
create materialized view if not exists public.leaderboard_view as
select
  p.id,
  p.display_name,
  p.avatar,
  p.plan,
  p.win_rate,
  coalesce(agg.total_pnl, 0)     as total_pnl,
  coalesce(agg.total_pnl_pct, 0) as total_return_pct,
  coalesce(agg.agent_count, 0)   as agent_count,
  coalesce(agg.trade_count, 0)   as trade_count,
  rank() over (order by coalesce(agg.total_pnl_pct, 0) desc) as rank
from public.profiles p
left join (
  select
    user_id,
    sum(pnl)          as total_pnl,
    sum(pnl_pct)      as total_pnl_pct,
    count(*)          as agent_count,
    sum(trades_count) as trade_count
  from public.agents
  where status in ('active', 'paused', 'stopped')
  group by user_id
) agg on agg.user_id = p.id
with data;

create unique index if not exists leaderboard_view_id_idx on public.leaderboard_view(id);
create index if not exists leaderboard_view_rank_idx      on public.leaderboard_view(rank);

-- Refresh function (call this on a schedule or after trades are inserted)
create or replace function public.refresh_leaderboard()
returns void
language sql
security definer
as $$
  refresh materialized view concurrently public.leaderboard_view;
$$;

-- ──────────────────────────────────────────────────────────────
-- 11. REALTIME: Enable for trades table
-- ──────────────────────────────────────────────────────────────
-- Run this separately in Supabase Dashboard → Database → Replication
-- if it fails here (requires superuser in some environments):
-- alter publication supabase_realtime add table public.trades;
-- alter publication supabase_realtime add table public.agents;

do $$
begin
  begin
    alter publication supabase_realtime add table public.trades;
  exception when others then
    raise notice 'Could not add trades to realtime publication (may already exist): %', sqlerrm;
  end;
  begin
    alter publication supabase_realtime add table public.agents;
  exception when others then
    raise notice 'Could not add agents to realtime publication (may already exist): %', sqlerrm;
  end;
end $$;

-- ──────────────────────────────────────────────────────────────
-- 12. SEED: Insert a free subscription for existing users
--     (runs safely with on conflict do nothing)
-- ──────────────────────────────────────────────────────────────
-- This is handled automatically when users sign up via the trigger.
-- To back-fill existing auth users who may not have profiles:
insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data->>'display_name', email, '')
from auth.users
on conflict (id) do nothing;

-- ============================================================
-- DONE — Schema created successfully.
--
-- NEXT STEPS in Supabase Dashboard:
-- 1. Authentication → Providers → Enable Google (add client ID/secret)
-- 2. Database → Replication → Enable realtime for "trades" and "agents"
-- 3. Edge Functions (optional) → Deploy refresh_leaderboard on a cron
-- ============================================================
