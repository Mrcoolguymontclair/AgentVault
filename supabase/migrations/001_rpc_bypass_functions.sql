-- ============================================================
-- RPC BYPASS FUNCTIONS
-- Bypasses PostgREST schema cache (PGRST205) by wrapping all
-- database operations in SECURITY DEFINER functions.
-- Run this in the Supabase SQL Editor AFTER 000_run_this_first.
-- ============================================================

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
  p_user_id uuid,
  p_name text,
  p_strategy text,
  p_description text,
  p_mode text,
  p_config jsonb,
  p_budget numeric,
  p_is_private boolean,
  p_model_id text
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
    p_user_id, p_name, p_strategy, p_description, 'backtesting'::agent_status, p_mode::agent_mode, p_config,
    p_budget, p_is_private, p_model_id, 0, 0, 0, 0, 0, 0
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
  UPDATE agents SET status = p_status::agent_status, updated_at = now()
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
  p_user_id uuid,
  p_display_name text DEFAULT NULL,
  p_avatar text DEFAULT NULL,
  p_trading_level text DEFAULT NULL,
  p_plan text DEFAULT NULL
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
    display_name  = COALESCE(p_display_name,              profiles.display_name),
    avatar        = COALESCE(p_avatar,                    profiles.avatar),
    trading_level = COALESCE(p_trading_level::trading_level, profiles.trading_level),
    plan          = COALESCE(p_plan::subscription_plan,   profiles.plan),
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
        'name', a.name,
        'strategy', a.strategy,
        'user_id', a.user_id,
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
        'name', a.name,
        'strategy', a.strategy,
        'user_id', a.user_id,
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
  v_result json;
BEGIN
  INSERT INTO comments (user_id, agent_id, content)
  VALUES (p_user_id, p_agent_id, trim(p_content))
  RETURNING id INTO v_comment_id;

  SELECT json_build_object(
    'id', c.id,
    'user_id', c.user_id,
    'agent_id', c.agent_id,
    'content', c.content,
    'likes', c.likes,
    'created_at', c.created_at,
    'profiles', json_build_object('display_name', p.display_name, 'avatar', p.avatar)
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
    AND a.status IN ('active'::agent_status, 'paused'::agent_status, 'backtesting'::agent_status);
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
        'user_id', d.user_id,
        'display_name', d.display_name,
        'avatar', d.avatar,
        'pnl_pct', d.pnl_pct,
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

-- ─── GRANT EXECUTE ────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION rpc_get_user_agents(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_create_agent(uuid,text,text,text,text,jsonb,numeric,boolean,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_delete_agent(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_update_agent_status(uuid,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_recent_trades(uuid,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_public_agent(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_agent_trades(uuid,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_check_agent_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_portfolio_snapshots(uuid,date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_profile(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_upsert_profile(uuid,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_update_active_agent_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_agent_leaderboard(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_period_returns(timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trending_agents(timestamptz,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_followed_agent_ids(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_follow_agent(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_unfollow_agent(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_leaderboard(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_user_rank(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trade_feed(uuid[],integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trade_by_id(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_comments(uuid,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_post_comment(uuid,uuid,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_delete_comment(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trader_profile(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_trader_public_agents(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_suggested_agent_owners(uuid,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_follow_user(uuid,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_unfollow_user(uuid,uuid) TO anon, authenticated;
