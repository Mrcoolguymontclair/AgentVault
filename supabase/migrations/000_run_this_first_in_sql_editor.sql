-- ============================================================
-- AgentVault — FULL SCHEMA SETUP (corrected)
-- Paste this entire file into: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. EXTENSIONS
-- ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────────────────────────────
-- 2. ENUMS (safe to re-run)
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE agent_status      AS ENUM ('active','paused','stopped','backtesting'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE agent_mode        AS ENUM ('paper','live');                           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE trade_side        AS ENUM ('buy','sell');                             EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE subscription_plan AS ENUM ('free','pro','elite');                     EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE subscription_status AS ENUM ('active','cancelled','expired','trial'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE trading_level     AS ENUM ('beginner','intermediate','advanced','professional'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ──────────────────────────────────────────────────────────────
-- 3. TABLES
-- ──────────────────────────────────────────────────────────────

-- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name      TEXT        NOT NULL DEFAULT '',
  avatar            TEXT        NOT NULL DEFAULT '🚀',
  trading_level     trading_level NOT NULL DEFAULT 'beginner',
  plan              subscription_plan NOT NULL DEFAULT 'free',
  balance           NUMERIC(14,2) NOT NULL DEFAULT 10000.00,
  total_return_pct  NUMERIC(8,4)  NOT NULL DEFAULT 0,
  win_rate          NUMERIC(5,2)  NOT NULL DEFAULT 0,
  rank              INTEGER,
  active_agents     INTEGER       NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- agents (includes extended columns from migration 002)
CREATE TABLE IF NOT EXISTS public.agents (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name          TEXT          NOT NULL,
  strategy      TEXT          NOT NULL,
  description   TEXT          NOT NULL DEFAULT '',
  status        agent_status  NOT NULL DEFAULT 'backtesting',
  mode          agent_mode    NOT NULL DEFAULT 'paper',
  pnl           NUMERIC(14,2) NOT NULL DEFAULT 0,
  pnl_pct       NUMERIC(8,4)  NOT NULL DEFAULT 0,
  trades_count  INTEGER       NOT NULL DEFAULT 0,
  win_rate      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  max_drawdown  NUMERIC(5,2)  NOT NULL DEFAULT 0,
  sharpe_ratio  NUMERIC(6,3)  NOT NULL DEFAULT 0,
  config        JSONB                  DEFAULT '{}',
  budget        NUMERIC(12,2)          DEFAULT 1000,
  is_private    BOOLEAN       NOT NULL DEFAULT FALSE,
  model_id      TEXT          NOT NULL DEFAULT 'groq_llama',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- trades
CREATE TABLE IF NOT EXISTS public.trades (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id    UUID          NOT NULL REFERENCES public.agents(id)   ON DELETE CASCADE,
  user_id     UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  symbol      TEXT          NOT NULL,
  side        trade_side    NOT NULL,
  quantity    NUMERIC(18,8) NOT NULL,
  price       NUMERIC(14,4) NOT NULL,
  pnl         NUMERIC(14,2) NOT NULL DEFAULT 0,
  executed_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- portfolio_snapshots
CREATE TABLE IF NOT EXISTS public.portfolio_snapshots (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id      UUID                   REFERENCES public.agents(id)   ON DELETE SET NULL,
  value         NUMERIC(14,2) NOT NULL,
  pnl_pct       NUMERIC(8,4)  NOT NULL DEFAULT 0,
  snapshot_date DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, agent_id, snapshot_date)
);

-- follows (trader-to-trader social graph)
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

-- comments
CREATE TABLE IF NOT EXISTS public.comments (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id   UUID                 REFERENCES public.agents(id)   ON DELETE SET NULL,
  content    TEXT        NOT NULL,
  likes      INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- agent_follows — uses follower_id (NOT user_id)
CREATE TABLE IF NOT EXISTS public.agent_follows (
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES public.agents(id)   ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, agent_id)
);

-- subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id         UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID               NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan       subscription_plan  NOT NULL DEFAULT 'free',
  status     subscription_status NOT NULL DEFAULT 'active',
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────
-- 4. INDEXES
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agents_user_id             ON public.agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_status              ON public.agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_is_private          ON public.agents(is_private);
CREATE INDEX IF NOT EXISTS idx_trades_agent_id            ON public.trades(agent_id);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at         ON public.trades(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_user_id             ON public.trades(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id       ON public.follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id        ON public.follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_agent_follows_agent_id     ON public.agent_follows(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_follows_follower_id  ON public.agent_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_id          ON public.portfolio_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_date             ON public.portfolio_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_comments_agent_id          ON public.comments(agent_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id           ON public.comments(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id      ON public.subscriptions(user_id);

-- ──────────────────────────────────────────────────────────────
-- 5. GRANTS — expose public schema to PostgREST
-- ──────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL   ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
GRANT ALL   ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL   ON ALL ROUTINES  IN SCHEMA public TO anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_follows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions       ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────
-- 7. POLICIES
-- Drop each individually with IF EXISTS before recreating.
-- Using separate DROP statements (no DO wrapper) so errors surface clearly.
-- ──────────────────────────────────────────────────────────────

-- profiles
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- agents
DROP POLICY IF EXISTS "agents_select_all" ON public.agents;
DROP POLICY IF EXISTS "agents_insert_own" ON public.agents;
DROP POLICY IF EXISTS "agents_update_own" ON public.agents;
DROP POLICY IF EXISTS "agents_delete_own" ON public.agents;
CREATE POLICY "agents_select_all" ON public.agents FOR SELECT USING (true);
CREATE POLICY "agents_insert_own" ON public.agents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agents_update_own" ON public.agents FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agents_delete_own" ON public.agents FOR DELETE USING (auth.uid() = user_id);

-- trades
DROP POLICY IF EXISTS "trades_select_own"          ON public.trades;
DROP POLICY IF EXISTS "trades_insert_own"           ON public.trades;
DROP POLICY IF EXISTS "trades_select_public_agents" ON public.trades;
CREATE POLICY "trades_select_own"          ON public.trades FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "trades_insert_own"          ON public.trades FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trades_select_public_agents" ON public.trades FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.agents a WHERE a.id = trades.agent_id AND a.is_private = FALSE)
);

-- portfolio_snapshots
DROP POLICY IF EXISTS "snapshots_select_own" ON public.portfolio_snapshots;
DROP POLICY IF EXISTS "snapshots_insert_own" ON public.portfolio_snapshots;
DROP POLICY IF EXISTS "snapshots_update_own" ON public.portfolio_snapshots;
CREATE POLICY "snapshots_select_own" ON public.portfolio_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "snapshots_insert_own" ON public.portfolio_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "snapshots_update_own" ON public.portfolio_snapshots FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- follows
DROP POLICY IF EXISTS "follows_select_all"  ON public.follows;
DROP POLICY IF EXISTS "follows_insert_own"  ON public.follows;
DROP POLICY IF EXISTS "follows_delete_own"  ON public.follows;
CREATE POLICY "follows_select_all" ON public.follows FOR SELECT USING (true);
CREATE POLICY "follows_insert_own" ON public.follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows_delete_own" ON public.follows FOR DELETE USING (auth.uid() = follower_id);

-- comments
DROP POLICY IF EXISTS "comments_select_all" ON public.comments;
DROP POLICY IF EXISTS "comments_insert_own" ON public.comments;
DROP POLICY IF EXISTS "comments_update_own" ON public.comments;
DROP POLICY IF EXISTS "comments_delete_own" ON public.comments;
CREATE POLICY "comments_select_all" ON public.comments FOR SELECT USING (true);
CREATE POLICY "comments_insert_own" ON public.comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_update_own" ON public.comments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_delete_own" ON public.comments FOR DELETE USING (auth.uid() = user_id);

-- agent_follows — note: column is follower_id, not user_id
DROP POLICY IF EXISTS "agent_follows_manage_own" ON public.agent_follows;
DROP POLICY IF EXISTS "agent_follows_read_all"   ON public.agent_follows;
CREATE POLICY "agent_follows_manage_own" ON public.agent_follows FOR ALL USING (auth.uid() = follower_id);
CREATE POLICY "agent_follows_read_all"   ON public.agent_follows FOR SELECT USING (true);

-- subscriptions
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subscriptions_insert_own" ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subscriptions_update_own" ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────
-- 8. TRIGGERS
-- ──────────────────────────────────────────────────────────────

-- Auto-create profile row on signup (covers Google OAuth via full_name)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar, trading_level)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      SPLIT_PART(NEW.email, '@', 1),
      ''
    ),
    COALESCE(NEW.raw_user_meta_data->>'avatar', '🚀'),
    COALESCE(
      (NEW.raw_user_meta_data->>'trading_level')::trading_level,
      'beginner'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Keep updated_at current
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at      ON public.profiles;
DROP TRIGGER IF EXISTS agents_updated_at        ON public.agents;
DROP TRIGGER IF EXISTS comments_updated_at      ON public.comments;
DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;

CREATE TRIGGER profiles_updated_at      BEFORE UPDATE ON public.profiles      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER agents_updated_at        BEFORE UPDATE ON public.agents        FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER comments_updated_at      BEFORE UPDATE ON public.comments      FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- 9. LEADERBOARD VIEW
-- Regular view (not materialized) — auto-reflects live data.
-- Column names match what the app's leaderboard service queries.
-- ──────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.agent_leaderboard CASCADE;

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
  COALESCE(fc.followers_count, 0)::INTEGER AS followers_count,
  RANK() OVER (ORDER BY a.pnl_pct DESC NULLS LAST)::INTEGER AS rank
FROM public.agents a
JOIN public.profiles p ON p.id = a.user_id
LEFT JOIN (
  SELECT agent_id, COUNT(*)::INTEGER AS followers_count
  FROM public.agent_follows
  GROUP BY agent_id
) fc ON fc.agent_id = a.id
WHERE a.is_private = FALSE
  AND a.status IN ('active', 'paused', 'backtesting');

GRANT SELECT ON public.agent_leaderboard TO authenticated, anon;

-- ──────────────────────────────────────────────────────────────
-- 10. REALTIME
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;      EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;      EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;    EXCEPTION WHEN others THEN NULL; END;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 11. BACK-FILL existing auth users → profiles
-- Safe: ON CONFLICT DO NOTHING skips users who already have a profile.
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, display_name, avatar)
SELECT
  u.id,
  COALESCE(
    u.raw_user_meta_data->>'display_name',
    u.raw_user_meta_data->>'full_name',
    SPLIT_PART(u.email, '@', 1),
    ''
  ),
  COALESCE(u.raw_user_meta_data->>'avatar', '🚀')
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 12. SCHEMA CACHE RELOAD
-- ──────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
