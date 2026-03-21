-- ─────────────────────────────────────────────────────────────────────────────
-- 017_custom_api_keys.sql
-- Custom AI API Keys: users bring their own keys for unlimited agent runs.
-- Falls back to app's built-in Groq keys when custom keys are exhausted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_api_keys (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider          text        NOT NULL CHECK (provider IN ('groq','openai','anthropic')),
  label             text        NOT NULL,
  api_key_encrypted text        NOT NULL,
  model_id          text,
  priority          int         NOT NULL DEFAULT 0,
  is_active         boolean     NOT NULL DEFAULT true,
  total_tokens_used bigint      NOT NULL DEFAULT 0,
  total_requests    int         NOT NULL DEFAULT 0,
  last_used_at      timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user ON user_api_keys(user_id, priority);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own keys" ON user_api_keys
  FOR ALL USING (auth.uid() = user_id);

-- ── RPCs ──────────────────────────────────────────────────────────────────────

-- Get all keys for a user (masked api_key, for UI display)
CREATE OR REPLACE FUNCTION rpc_get_user_api_keys(p_user_id uuid)
RETURNS TABLE (
  id                uuid,
  provider          text,
  label             text,
  api_key_masked    text,
  model_id          text,
  priority          int,
  is_active         boolean,
  total_tokens_used bigint,
  total_requests    int,
  last_used_at      timestamptz,
  last_error        text,
  created_at        timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    id,
    provider,
    label,
    LEFT(api_key_encrypted, 8) || '...' AS api_key_masked,
    model_id,
    priority,
    is_active,
    total_tokens_used,
    total_requests,
    last_used_at,
    last_error,
    created_at
  FROM user_api_keys
  WHERE user_id = p_user_id
  ORDER BY priority ASC, created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION rpc_get_user_api_keys(uuid) TO authenticated;

-- Add a new key
CREATE OR REPLACE FUNCTION rpc_add_api_key(
  p_user_id   uuid,
  p_provider  text,
  p_label     text,
  p_api_key   text,
  p_model_id  text  DEFAULT NULL,
  p_priority  int   DEFAULT 0
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO user_api_keys (user_id, provider, label, api_key_encrypted, model_id, priority)
  VALUES (p_user_id, p_provider, p_label, p_api_key, p_model_id, p_priority)
  RETURNING id;
$$;

GRANT EXECUTE ON FUNCTION rpc_add_api_key(uuid, text, text, text, text, int) TO authenticated;

-- Update a single key's priority
CREATE OR REPLACE FUNCTION rpc_update_key_priority(p_key_id uuid, p_new_priority int)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE user_api_keys
  SET priority = p_new_priority, updated_at = now()
  WHERE id = p_key_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION rpc_update_key_priority(uuid, int) TO authenticated;

-- Bulk reorder: set priority = array index for each key id
CREATE OR REPLACE FUNCTION rpc_reorder_keys(p_user_id uuid, p_key_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  i int;
BEGIN
  FOR i IN 1..array_length(p_key_ids, 1) LOOP
    UPDATE user_api_keys
    SET priority = i - 1, updated_at = now()
    WHERE id = p_key_ids[i] AND user_id = p_user_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_reorder_keys(uuid, uuid[]) TO authenticated;

-- Delete a key
CREATE OR REPLACE FUNCTION rpc_delete_api_key(p_key_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM user_api_keys
  WHERE id = p_key_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION rpc_delete_api_key(uuid) TO authenticated;

-- Toggle a key active/inactive
CREATE OR REPLACE FUNCTION rpc_toggle_api_key(p_key_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE user_api_keys
  SET is_active = p_is_active, updated_at = now()
  WHERE id = p_key_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION rpc_toggle_api_key(uuid, boolean) TO authenticated;

-- Update usage counters after a successful AI call
CREATE OR REPLACE FUNCTION rpc_update_key_usage(p_key_id uuid, p_tokens int, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE user_api_keys SET
    total_tokens_used = total_tokens_used + CASE WHEN p_error IS NULL THEN p_tokens ELSE 0 END,
    total_requests    = total_requests    + CASE WHEN p_error IS NULL THEN 1 ELSE 0 END,
    last_used_at      = CASE WHEN p_error IS NULL THEN now() ELSE last_used_at END,
    last_error        = p_error,
    updated_at        = now()
  WHERE id = p_key_id;
$$;

GRANT EXECUTE ON FUNCTION rpc_update_key_usage(uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_update_key_usage(uuid, int, text) TO service_role;

-- Get all active keys for a user (UNMASKED — service role / edge function only)
CREATE OR REPLACE FUNCTION rpc_get_key_for_agent(p_user_id uuid)
RETURNS TABLE (
  id         uuid,
  provider   text,
  model_id   text,
  api_key    text,
  label      text,
  priority   int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, provider, model_id, api_key_encrypted AS api_key, label, priority
  FROM user_api_keys
  WHERE user_id = p_user_id AND is_active = true
  ORDER BY priority ASC;
$$;

-- Only service_role (edge functions) may call this — never grant to authenticated
GRANT EXECUTE ON FUNCTION rpc_get_key_for_agent(uuid) TO service_role;
