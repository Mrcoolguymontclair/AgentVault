-- ============================================================
-- Migration 004: Subscriptions, Alpaca keys, account tools
-- ============================================================

-- ─── Alpaca API keys on profile ──────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alpaca_key_id   TEXT,
  ADD COLUMN IF NOT EXISTS alpaca_key_secret TEXT;

-- ─── Subscriptions table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan          subscription_plan NOT NULL DEFAULT 'free',
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','canceled','past_due','trialing')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own subscription" ON public.subscriptions
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── RPC: save Alpaca keys ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_save_alpaca_keys(
  p_user_id      UUID,
  p_key_id       TEXT,
  p_key_secret   TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
  SET alpaca_key_id     = p_key_id,
      alpaca_key_secret = p_key_secret,
      updated_at        = NOW()
  WHERE id = p_user_id;
END;
$$;

-- ─── RPC: get Alpaca key status (masked) ────────────────────
CREATE OR REPLACE FUNCTION public.rpc_get_alpaca_key_status(
  p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key_id TEXT;
  v_secret TEXT;
BEGIN
  SELECT alpaca_key_id, alpaca_key_secret
  INTO v_key_id, v_secret
  FROM public.profiles WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'has_keys',    (v_key_id IS NOT NULL AND v_key_id <> ''),
    'key_id_hint', CASE
                     WHEN v_key_id IS NOT NULL AND LENGTH(v_key_id) >= 4
                     THEN '••••' || RIGHT(v_key_id, 4)
                     ELSE NULL
                   END
  );
END;
$$;

-- ─── RPC: upgrade plan (MVP — no Stripe) ─────────────────────
CREATE OR REPLACE FUNCTION public.rpc_upgrade_plan(
  p_user_id UUID,
  p_plan    TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
  SET plan       = p_plan::subscription_plan,
      updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (p_user_id, p_plan::subscription_plan, 'active')
  ON CONFLICT (user_id) DO UPDATE
    SET plan       = p_plan::subscription_plan,
        status     = 'active',
        started_at = NOW(),
        updated_at = NOW();
END;
$$;

-- ─── RPC: delete account ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_delete_account(
  p_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Cascade deletes handle all child rows via ON DELETE CASCADE
  DELETE FROM public.profiles WHERE id = p_user_id;
  -- Note: actual auth.users row deletion is handled client-side
  -- via supabase.auth.admin.deleteUser (requires service key) or
  -- by the user via Supabase dashboard. This clears all app data.
END;
$$;

-- ─── RPC: export trade history (CSV rows as JSONB array) ─────
CREATE OR REPLACE FUNCTION public.rpc_export_trades(
  p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',          t.id,
      'agent_id',    t.agent_id,
      'agent_name',  a.name,
      'symbol',      t.symbol,
      'side',        t.side,
      'qty',         t.qty,
      'price',       t.price,
      'pnl',         t.pnl,
      'created_at',  t.created_at
    )
    ORDER BY t.created_at DESC
  )
  INTO v_result
  FROM public.trades t
  JOIN public.agents a ON a.id = t.agent_id
  WHERE t.user_id = p_user_id;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- ─── Grant execute ───────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.rpc_save_alpaca_keys   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_alpaca_key_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upgrade_plan        TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_delete_account      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_export_trades       TO authenticated;

-- ─── Realtime on subscriptions ───────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;

NOTIFY pgrst, 'reload schema';
