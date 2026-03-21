-- ─────────────────────────────────────────────────────────────────────────────
-- 016_strategy_lab.sql
-- Strategy Lab: meta-learning agent that evolves trading strategies over time.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategy_generations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id           uuid REFERENCES strategy_generations(id),
  generation_number   int NOT NULL DEFAULT 1,
  agent_id            uuid REFERENCES agents(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES profiles(id),
  strategy_rules      text NOT NULL,
  parameters          jsonb NOT NULL DEFAULT '{}',
  mutation_description text,
  status              text NOT NULL DEFAULT 'testing',  -- testing | graduated | killed
  test_budget         numeric DEFAULT 500,
  test_start_date     timestamptz DEFAULT now(),
  test_end_date       timestamptz,
  total_trades        int DEFAULT 0,
  total_pnl           numeric DEFAULT 0,
  win_rate            numeric DEFAULT 0,
  sharpe_ratio        numeric DEFAULT 0,
  max_drawdown        numeric DEFAULT 0,
  vs_spy_pct          numeric DEFAULT 0,
  insight             text,          -- AI insight from daily analysis
  graduated           boolean DEFAULT false,
  killed              boolean DEFAULT false,
  kill_reason         text,
  created_at          timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE strategy_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_generations" ON strategy_generations
  FOR ALL USING (user_id = auth.uid());

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- Create a new generation
CREATE OR REPLACE FUNCTION rpc_create_generation(
  p_agent_id          uuid,
  p_user_id           uuid,
  p_strategy_rules    text,
  p_parameters        jsonb DEFAULT '{}',
  p_parent_id         uuid DEFAULT NULL,
  p_generation_number int DEFAULT 1,
  p_mutation_desc     text DEFAULT NULL,
  p_insight           text DEFAULT NULL
) RETURNS strategy_generations
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO strategy_generations (
    agent_id, user_id, strategy_rules, parameters,
    parent_id, generation_number, mutation_description, insight
  ) VALUES (
    p_agent_id, p_user_id, p_strategy_rules, p_parameters,
    p_parent_id, p_generation_number, p_mutation_desc, p_insight
  )
  RETURNING *;
$$;

GRANT EXECUTE ON FUNCTION rpc_create_generation(uuid, uuid, text, jsonb, uuid, int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_create_generation(uuid, uuid, text, jsonb, uuid, int, text, text) TO service_role;

-- Get all generations for an agent
CREATE OR REPLACE FUNCTION rpc_get_generations(p_agent_id uuid)
RETURNS SETOF strategy_generations
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM strategy_generations
  WHERE agent_id = p_agent_id
  ORDER BY generation_number ASC, created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_generations(uuid) TO authenticated;

-- Update generation stats after testing
CREATE OR REPLACE FUNCTION rpc_update_generation_stats(
  p_id          uuid,
  p_total_trades int,
  p_total_pnl   numeric,
  p_win_rate    numeric,
  p_sharpe      numeric,
  p_max_dd      numeric,
  p_vs_spy_pct  numeric,
  p_status      text DEFAULT NULL
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE strategy_generations SET
    total_trades = p_total_trades,
    total_pnl    = p_total_pnl,
    win_rate     = p_win_rate,
    sharpe_ratio = p_sharpe,
    max_drawdown = p_max_dd,
    vs_spy_pct   = p_vs_spy_pct,
    status       = COALESCE(p_status, status),
    graduated    = (COALESCE(p_status, status) = 'graduated'),
    killed       = (COALESCE(p_status, status) = 'killed'),
    test_end_date = CASE WHEN COALESCE(p_status, status) IN ('graduated','killed') THEN now() ELSE test_end_date END
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION rpc_update_generation_stats(uuid, int, numeric, numeric, numeric, numeric, numeric, text) TO service_role;

-- Get best (graduated) generations for an agent
CREATE OR REPLACE FUNCTION rpc_get_best_generations(p_agent_id uuid)
RETURNS SETOF strategy_generations
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM strategy_generations
  WHERE agent_id = p_agent_id AND graduated = true
  ORDER BY sharpe_ratio DESC, win_rate DESC
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_best_generations(uuid) TO authenticated;

-- Kill a generation
CREATE OR REPLACE FUNCTION rpc_kill_generation(p_id uuid, p_reason text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE strategy_generations SET
    status = 'killed',
    killed = true,
    kill_reason = p_reason,
    test_end_date = now()
  WHERE id = p_id;
$$;

GRANT EXECUTE ON FUNCTION rpc_kill_generation(uuid, text) TO service_role;
