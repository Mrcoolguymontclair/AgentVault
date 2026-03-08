-- ============================================================
-- AgentVault — FULL DATABASE SETUP (single file, fresh project)
-- Paste this entire file into: Supabase Dashboard → SQL Editor → Run
-- ============================================================


-- ──────────────────────────────────────────────────────────────
-- 1. EXTENSIONS
-- ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ──────────────────────────────────────────────────────────────
-- 2. ENUMS
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

CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID              PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name      TEXT              NOT NULL DEFAULT '',
  avatar            TEXT              NOT NULL DEFAULT '🚀',
  trading_level     trading_level     NOT NULL DEFAULT 'beginner',
  plan              subscription_plan NOT NULL DEFAULT 'free',
  balance           NUMERIC(14,2)     NOT NULL DEFAULT 10000.00,
  total_return_pct  NUMERIC(8,4)      NOT NULL DEFAULT 0,
  win_rate          NUMERIC(5,2)      NOT NULL DEFAULT 0,
  rank              INTEGER,
  active_agents     INTEGER           NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

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

-- trader-to-trader social graph
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS public.comments (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id   UUID                 REFERENCES public.agents(id)   ON DELETE SET NULL,
  content    TEXT        NOT NULL,
  likes      INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- agent follow graph — uses follower_id (NOT user_id)
CREATE TABLE IF NOT EXISTS public.agent_follows (
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES public.agents(id)   ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, agent_id)
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id         UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID                NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan       subscription_plan   NOT NULL DEFAULT 'free',
  status     subscription_status NOT NULL DEFAULT 'active',
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ         NOT NULL DEFAULT NOW()
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
-- 5. SCHEMA / TABLE GRANTS (PostgREST access)
-- ──────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL   ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
GRANT ALL   ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL   ON ALL ROUTINES  IN SCHEMA public TO anon, authenticated;


-- ──────────────────────────────────────────────────────────────
-- 6. ROW LEVEL SECURITY — enable
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
-- 7. RLS POLICIES
-- ──────────────────────────────────────────────────────────────

-- profiles
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- agents
DROP POLICY IF EXISTS "agents_select_all"  ON public.agents;
DROP POLICY IF EXISTS "agents_insert_own"  ON public.agents;
DROP POLICY IF EXISTS "agents_update_own"  ON public.agents;
DROP POLICY IF EXISTS "agents_delete_own"  ON public.agents;
CREATE POLICY "agents_select_all" ON public.agents FOR SELECT USING (true);
CREATE POLICY "agents_insert_own" ON public.agents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agents_update_own" ON public.agents FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "agents_delete_own" ON public.agents FOR DELETE USING (auth.uid() = user_id);

-- trades
DROP POLICY IF EXISTS "trades_select_own"          ON public.trades;
DROP POLICY IF EXISTS "trades_insert_own"           ON public.trades;
DROP POLICY IF EXISTS "trades_select_public_agents" ON public.trades;
CREATE POLICY "trades_select_own"   ON public.trades FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "trades_insert_own"   ON public.trades FOR INSERT WITH CHECK (auth.uid() = user_id);
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
DROP POLICY IF EXISTS "follows_select_all" ON public.follows;
DROP POLICY IF EXISTS "follows_insert_own" ON public.follows;
DROP POLICY IF EXISTS "follows_delete_own" ON public.follows;
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

-- agent_follows — column is follower_id, not user_id
DROP POLICY IF EXISTS "agent_follows_manage_own" ON public.agent_follows;
DROP POLICY IF EXISTS "agent_follows_read_all"   ON public.agent_follows;
CREATE POLICY "agent_follows_manage_own" ON public.agent_follows FOR ALL    USING (auth.uid() = follower_id);
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
-- 9. VIEWS
-- ──────────────────────────────────────────────────────────────

-- agent_leaderboard: one row per public agent, ranked by pnl_pct
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
  AND a.status IN ('active'::agent_status, 'paused'::agent_status, 'backtesting'::agent_status);

-- leaderboard_view: one row per user (trader-level leaderboard)
DROP VIEW IF EXISTS public.leaderboard_view CASCADE;
CREATE OR REPLACE VIEW public.leaderboard_view AS
SELECT
  p.id,
  p.display_name,
  p.avatar,
  p.plan,
  p.win_rate,
  COALESCE(SUM(a.pnl), 0)        AS total_pnl,
  p.total_return_pct,
  COUNT(DISTINCT a.id)::INTEGER  AS agent_count,
  COUNT(DISTINCT t.id)::INTEGER  AS trade_count,
  RANK() OVER (ORDER BY p.total_return_pct DESC NULLS LAST)::INTEGER AS rank
FROM public.profiles p
LEFT JOIN public.agents a ON a.user_id = p.id
LEFT JOIN public.trades t ON t.user_id = p.id
GROUP BY p.id, p.display_name, p.avatar, p.plan, p.win_rate, p.total_return_pct;

GRANT SELECT ON public.agent_leaderboard TO authenticated, anon;
GRANT SELECT ON public.leaderboard_view  TO authenticated, anon;


-- ──────────────────────────────────────────────────────────────
-- 10. REALTIME
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;   EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;   EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.comments; EXCEPTION WHEN others THEN NULL; END;
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
-- 12. RPC BYPASS FUNCTIONS
-- SECURITY DEFINER functions bypass PostgREST's table-level
-- schema cache entirely — all app DB calls go through these.
-- ──────────────────────────────────────────────────────────────

-- ─── AGENTS ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_get_user_agents(p_user_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(a ORDER BY a.created_at DESC), '[]'::json)
  FROM agents a
  WHERE a.user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION rpc_create_agent(
  p_user_id    uuid,
  p_name       text,
  p_strategy   text,
  p_description text,
  p_mode       text,
  p_config     jsonb,
  p_budget     numeric,
  p_is_private boolean,
  p_model_id   text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  INSERT INTO agents (
    user_id, name, strategy, description, status, mode, config,
    budget, is_private, model_id, pnl, pnl_pct, trades_count,
    win_rate, max_drawdown, sharpe_ratio
  ) VALUES (
    p_user_id, p_name, p_strategy, p_description,
    'backtesting'::agent_status,
    p_mode::agent_mode,
    p_config,
    p_budget, p_is_private, p_model_id,
    0, 0, 0, 0, 0, 0
  )
  RETURNING row_to_json(agents.*) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_delete_agent(p_agent_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM agents WHERE id = p_agent_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION rpc_update_agent_status(p_agent_id uuid, p_status text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE agents
  SET status = p_status::agent_status, updated_at = now()
  WHERE id = p_agent_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION rpc_get_recent_trades(p_user_id uuid, p_limit integer DEFAULT 10)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(q), '[]'::json)
  FROM (
    SELECT
      t.id, t.agent_id, t.user_id, t.symbol, t.side,
      t.quantity, t.price, t.pnl, t.executed_at,
      json_build_object('name', a.name) AS agents
    FROM trades t
    LEFT JOIN agents a ON a.id = t.agent_id
    WHERE t.user_id = p_user_id
    ORDER BY t.executed_at DESC
    LIMIT p_limit
  ) q;
$$;

CREATE OR REPLACE FUNCTION rpc_get_public_agent(p_agent_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(q)
  FROM (
    SELECT a.*,
      json_build_object('display_name', p.display_name, 'avatar', p.avatar) AS profiles
    FROM agents a
    LEFT JOIN profiles p ON p.id = a.user_id
    WHERE a.id = p_agent_id
  ) q;
$$;

CREATE OR REPLACE FUNCTION rpc_get_agent_trades(p_agent_id uuid, p_limit integer DEFAULT 50)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(q), '[]'::json)
  FROM (
    SELECT
      t.id, t.agent_id, t.user_id, t.symbol, t.side,
      t.quantity, t.price, t.pnl, t.executed_at,
      json_build_object('name', a.name) AS agents
    FROM trades t
    LEFT JOIN agents a ON a.id = t.agent_id
    WHERE t.agent_id = p_agent_id
    ORDER BY t.executed_at DESC
    LIMIT p_limit
  ) q;
$$;

CREATE OR REPLACE FUNCTION rpc_check_agent_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM agents
  WHERE user_id = p_user_id AND status != 'stopped'::agent_status;
$$;

-- ─── PORTFOLIO ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_get_portfolio_snapshots(p_user_id uuid, p_since date)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_object('snapshot_date', ps.snapshot_date, 'value', ps.value)
      ORDER BY ps.snapshot_date ASC
    ),
    '[]'::json
  )
  FROM portfolio_snapshots ps
  WHERE ps.user_id = p_user_id AND ps.snapshot_date >= p_since;
$$;

-- ─── PROFILES ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_get_profile(p_user_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(p) FROM profiles p WHERE p.id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION rpc_upsert_profile(
  p_user_id      uuid,
  p_display_name text DEFAULT NULL,
  p_avatar       text DEFAULT NULL,
  p_trading_level text DEFAULT NULL,
  p_plan         text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  INSERT INTO profiles (id, display_name, avatar, trading_level, plan)
  VALUES (
    p_user_id,
    COALESCE(p_display_name, 'Trader'),
    COALESCE(p_avatar, '🚀'),
    COALESCE(p_trading_level, 'beginner')::trading_level,
    COALESCE(p_plan, 'free')::subscription_plan
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name  = COALESCE(p_display_name,                    profiles.display_name),
    avatar        = COALESCE(p_avatar,                          profiles.avatar),
    trading_level = COALESCE(p_trading_level::trading_level,    profiles.trading_level),
    plan          = COALESCE(p_plan::subscription_plan,         profiles.plan),
    updated_at    = now()
  RETURNING row_to_json(profiles.*) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_update_active_agent_count(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM agents WHERE user_id = p_user_id AND status = 'active'::agent_status;
  UPDATE profiles SET active_agents = v_count WHERE id = p_user_id;
END;
$$;

-- ─── LEADERBOARD ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_get_agent_leaderboard(p_limit integer DEFAULT 100)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(al ORDER BY al.rank ASC),
    '[]'::json
  )
  FROM (SELECT * FROM agent_leaderboard ORDER BY rank ASC LIMIT p_limit) al;
$$;

CREATE OR REPLACE FUNCTION rpc_get_period_returns(p_since timestamptz)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(json_build_object('agent_id', agent_id, 'total_pnl', total_pnl)),
    '[]'::json
  )
  FROM (
    SELECT agent_id, SUM(pnl) AS total_pnl
    FROM trades
    WHERE executed_at >= p_since
    GROUP BY agent_id
  ) t;
$$;

CREATE OR REPLACE FUNCTION rpc_get_trending_agents(p_since timestamptz, p_limit integer DEFAULT 6)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  WITH period_pnl AS (
    SELECT agent_id, SUM(pnl) AS total_pnl
    FROM trades
    WHERE executed_at >= p_since AND pnl > 0
    GROUP BY agent_id
    ORDER BY total_pnl DESC
    LIMIT p_limit
  ),
  enriched AS (
    SELECT al.*, pp.total_pnl AS period_pnl
    FROM period_pnl pp
    JOIN agent_leaderboard al ON al.id = pp.agent_id
  )
  SELECT COALESCE(json_agg(enriched ORDER BY enriched.period_pnl DESC), '[]'::json)
  INTO v_result
  FROM enriched;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_get_followed_agent_ids(p_user_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(agent_id), '[]'::json)
  FROM agent_follows
  WHERE follower_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION rpc_follow_agent(p_follower_id uuid, p_agent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO agent_follows (follower_id, agent_id)
  VALUES (p_follower_id, p_agent_id)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_unfollow_agent(p_follower_id uuid, p_agent_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM agent_follows
  WHERE follower_id = p_follower_id AND agent_id = p_agent_id;
$$;

CREATE OR REPLACE FUNCTION rpc_get_leaderboard(p_limit integer DEFAULT 50)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(lv ORDER BY lv.rank ASC),
    '[]'::json
  )
  FROM (SELECT * FROM leaderboard_view ORDER BY rank ASC LIMIT p_limit) lv;
$$;

CREATE OR REPLACE FUNCTION rpc_get_user_rank(p_user_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(q)
  FROM (
    SELECT rank, total_return_pct, win_rate, agent_count, trade_count
    FROM leaderboard_view
    WHERE id = p_user_id
  ) q;
$$;

-- ─── SOCIAL ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_get_trade_feed(p_agent_ids uuid[], p_limit integer DEFAULT 40)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(q), '[]'::json)
  FROM (
    SELECT
      t.id, t.agent_id, t.symbol, t.side, t.quantity, t.price, t.pnl, t.executed_at,
      json_build_object(
        'name',     a.name,
        'strategy', a.strategy,
        'user_id',  a.user_id,
        'profiles', json_build_object('display_name', p.display_name, 'avatar', p.avatar)
      ) AS agents
    FROM trades t
    JOIN agents a ON a.id = t.agent_id
    LEFT JOIN profiles p ON p.id = a.user_id
    WHERE t.agent_id = ANY(p_agent_ids)
    ORDER BY t.executed_at DESC
    LIMIT p_limit
  ) q;
$$;

CREATE OR REPLACE FUNCTION rpc_get_trade_by_id(p_trade_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(q)
  FROM (
    SELECT
      t.id, t.agent_id, t.symbol, t.side, t.quantity, t.price, t.pnl, t.executed_at,
      json_build_object(
        'name',     a.name,
        'strategy', a.strategy,
        'user_id',  a.user_id,
        'profiles', json_build_object('display_name', p.display_name, 'avatar', p.avatar)
      ) AS agents
    FROM trades t
    JOIN agents a ON a.id = t.agent_id
    LEFT JOIN profiles p ON p.id = a.user_id
    WHERE t.id = p_trade_id
  ) q;
$$;

CREATE OR REPLACE FUNCTION rpc_get_comments(p_agent_id uuid, p_limit integer DEFAULT 50)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(q ORDER BY q.created_at ASC), '[]'::json)
  FROM (
    SELECT
      c.id, c.user_id, c.agent_id, c.content, c.likes, c.created_at,
      json_build_object('display_name', p.display_name, 'avatar', p.avatar) AS profiles
    FROM comments c
    LEFT JOIN profiles p ON p.id = c.user_id
    WHERE c.agent_id = p_agent_id
    LIMIT p_limit
  ) q;
$$;

CREATE OR REPLACE FUNCTION rpc_post_comment(p_user_id uuid, p_agent_id uuid, p_content text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comment_id uuid;
  v_result     json;
BEGIN
  INSERT INTO comments (user_id, agent_id, content)
  VALUES (p_user_id, p_agent_id, trim(p_content))
  RETURNING id INTO v_comment_id;

  SELECT json_build_object(
    'id',         c.id,
    'user_id',    c.user_id,
    'agent_id',   c.agent_id,
    'content',    c.content,
    'likes',      c.likes,
    'created_at', c.created_at,
    'profiles',   json_build_object('display_name', p.display_name, 'avatar', p.avatar)
  ) INTO v_result
  FROM comments c
  LEFT JOIN profiles p ON p.id = c.user_id
  WHERE c.id = v_comment_id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_delete_comment(p_comment_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM comments WHERE id = p_comment_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION rpc_get_trader_profile(p_user_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(q)
  FROM (
    SELECT id, display_name, avatar, plan, win_rate, total_return_pct, active_agents
    FROM profiles
    WHERE id = p_user_id
  ) q;
$$;

CREATE OR REPLACE FUNCTION rpc_get_trader_public_agents(p_user_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(a ORDER BY a.pnl_pct DESC),
    '[]'::json
  )
  FROM agents a
  WHERE a.user_id = p_user_id
    AND a.is_private = false
    AND a.status IN (
      'active'::agent_status,
      'paused'::agent_status,
      'backtesting'::agent_status
    );
$$;

CREATE OR REPLACE FUNCTION rpc_get_suggested_agent_owners(p_user_id uuid, p_limit integer DEFAULT 10)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  WITH deduped AS (
    SELECT DISTINCT ON (al.user_id)
      al.user_id, al.display_name, al.avatar, al.pnl_pct, al.followers_count, al.rank
    FROM agent_leaderboard al
    WHERE al.user_id != p_user_id
    ORDER BY al.user_id, al.rank ASC
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'user_id',         d.user_id,
        'display_name',    d.display_name,
        'avatar',          d.avatar,
        'pnl_pct',         d.pnl_pct,
        'followers_count', d.followers_count
      )
    ),
    '[]'::json
  ) INTO v_result
  FROM (SELECT * FROM deduped ORDER BY rank ASC LIMIT p_limit) d;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION rpc_follow_user(p_follower_id uuid, p_following_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO follows (follower_id, following_id)
  VALUES (p_follower_id, p_following_id)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_unfollow_user(p_follower_id uuid, p_following_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM follows
  WHERE follower_id = p_follower_id AND following_id = p_following_id;
$$;


-- ──────────────────────────────────────────────────────────────
-- 13. GRANT EXECUTE ON RPC FUNCTIONS
-- ──────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION rpc_get_user_agents(uuid)                                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_create_agent(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_delete_agent(uuid)                                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_update_agent_status(uuid,text)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_recent_trades(uuid,integer)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_public_agent(uuid)                               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_agent_trades(uuid,integer)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_check_agent_count(uuid)                              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_portfolio_snapshots(uuid,date)                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_profile(uuid)                                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_upsert_profile(uuid,text,text,text,text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_update_active_agent_count(uuid)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_agent_leaderboard(integer)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_period_returns(timestamptz)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trending_agents(timestamptz,integer)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_followed_agent_ids(uuid)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_follow_agent(uuid,uuid)                              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_unfollow_agent(uuid,uuid)                            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_leaderboard(integer)                             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_user_rank(uuid)                                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trade_feed(uuid[],integer)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trade_by_id(uuid)                                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_comments(uuid,integer)                           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_post_comment(uuid,uuid,text)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_delete_comment(uuid)                                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trader_profile(uuid)                             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trader_public_agents(uuid)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_suggested_agent_owners(uuid,integer)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_follow_user(uuid,uuid)                               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_unfollow_user(uuid,uuid)                             TO anon, authenticated;


-- ──────────────────────────────────────────────────────────────
-- 14. SCHEMA CACHE RELOAD
-- ──────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE. Fresh database is fully configured.
-- ============================================================
