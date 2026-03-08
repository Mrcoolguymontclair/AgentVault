-- ============================================================
-- Phase 9: Notifications
-- Run this in the Supabase SQL Editor AFTER FULL_SETUP.sql
-- ============================================================

-- ─── 1. ADD PUSH TOKEN COLUMN TO PROFILES ────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- ─── 2. NOTIFICATION PREFERENCES ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id         UUID    PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  my_trades       BOOLEAN NOT NULL DEFAULT true,
  stop_loss       BOOLEAN NOT NULL DEFAULT true,
  followed_agents BOOLEAN NOT NULL DEFAULT true,
  daily_summary   BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. NOTIFICATIONS TABLE ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL CHECK (type IN ('trade','stop_loss','followed_trade','daily_summary','welcome')),
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  data       JSONB       NOT NULL DEFAULT '{}',
  read       BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. INDEXES ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_id    ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read       ON public.notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id      ON public.notification_preferences(user_id);

-- ─── 5. RLS ───────────────────────────────────────────────────
ALTER TABLE public.notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifs_select_own"  ON public.notifications;
DROP POLICY IF EXISTS "notifs_insert_own"  ON public.notifications;
DROP POLICY IF EXISTS "notifs_update_own"  ON public.notifications;
DROP POLICY IF EXISTS "notifs_delete_own"  ON public.notifications;
CREATE POLICY "notifs_select_own" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifs_insert_own" ON public.notifications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifs_update_own" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifs_delete_own" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notif_prefs_own" ON public.notification_preferences;
CREATE POLICY "notif_prefs_own" ON public.notification_preferences FOR ALL USING (auth.uid() = user_id);

-- ─── 6. UPDATED_AT TRIGGER ───────────────────────────────────
DROP TRIGGER IF EXISTS notif_prefs_updated_at ON public.notification_preferences;
CREATE TRIGGER notif_prefs_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ─── 7. REALTIME ──────────────────────────────────────────────
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- ─── 8. GRANTS ────────────────────────────────────────────────
GRANT ALL ON public.notifications            TO anon, authenticated;
GRANT ALL ON public.notification_preferences TO anon, authenticated;

-- ─── 9. RPC FUNCTIONS ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION rpc_save_push_token(p_user_id uuid, p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE profiles SET expo_push_token = p_token WHERE id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION rpc_get_notifications(p_user_id uuid, p_limit integer DEFAULT 50)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(n ORDER BY n.created_at DESC), '[]'::json)
  FROM (
    SELECT id, user_id, type, title, body, data, read, created_at
    FROM notifications
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT p_limit
  ) n;
$$;

CREATE OR REPLACE FUNCTION rpc_mark_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE notifications SET read = true
  WHERE id = p_notification_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION rpc_mark_all_notifications_read(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE notifications SET read = true
  WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION rpc_get_notification_preferences(p_user_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(np)
  FROM notification_preferences np
  WHERE np.user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION rpc_upsert_notification_preferences(
  p_user_id       uuid,
  p_my_trades     boolean,
  p_stop_loss     boolean,
  p_followed_agents boolean,
  p_daily_summary boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  INSERT INTO notification_preferences (user_id, my_trades, stop_loss, followed_agents, daily_summary)
  VALUES (p_user_id, p_my_trades, p_stop_loss, p_followed_agents, p_daily_summary)
  ON CONFLICT (user_id) DO UPDATE SET
    my_trades       = p_my_trades,
    stop_loss       = p_stop_loss,
    followed_agents = p_followed_agents,
    daily_summary   = p_daily_summary,
    updated_at      = now()
  RETURNING row_to_json(notification_preferences.*) INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION rpc_insert_notification(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_body    text,
  p_data    jsonb DEFAULT '{}'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  INSERT INTO notifications (user_id, type, title, body, data)
  VALUES (p_user_id, p_type, p_title, p_body, p_data)
  RETURNING row_to_json(notifications.*) INTO v_result;
  RETURN v_result;
END;
$$;

-- ─── 10. GRANT EXECUTE ────────────────────────────────────────
GRANT EXECUTE ON FUNCTION rpc_save_push_token(uuid, text)                                          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_notifications(uuid, integer)                                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_mark_notification_read(uuid)                                          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_mark_all_notifications_read(uuid)                                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_notification_preferences(uuid)                                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_upsert_notification_preferences(uuid,boolean,boolean,boolean,boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_insert_notification(uuid,text,text,text,jsonb)                        TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE. Notifications schema ready.
-- ============================================================
