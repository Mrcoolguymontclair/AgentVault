import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";

// ─── Foreground presentation ──────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Types ────────────────────────────────────────────────────

export type NotificationType =
  | "trade"
  | "stop_loss"
  | "followed_trade"
  | "daily_summary"
  | "welcome";

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  read: boolean;
  created_at: string;
}

export interface NotificationPreferences {
  my_trades: boolean;
  stop_loss: boolean;
  followed_agents: boolean;
  daily_summary: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  my_trades: true,
  stop_loss: true,
  followed_agents: true,
  daily_summary: true,
};

// ─── Permission & token ───────────────────────────────────────

export async function requestNotificationPermission(): Promise<
  "granted" | "denied" | "undetermined"
> {
  if (Platform.OS === "web") return "denied";

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return "granted";

  const { status } = await Notifications.requestPermissionsAsync();
  return status as "granted" | "denied" | "undetermined";
}

export async function getNotificationPermissionStatus(): Promise<
  "granted" | "denied" | "undetermined"
> {
  if (Platform.OS === "web") return "denied";
  const { status } = await Notifications.getPermissionsAsync();
  return status as "granted" | "denied" | "undetermined";
}

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!Device.isDevice) return null;

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    return tokenData.data;
  } catch (e) {
    console.warn("[notifications] Could not get push token:", e);
    return null;
  }
}

export async function savePushToken(userId: string, token: string) {
  await supabase.rpc("rpc_save_push_token", {
    p_user_id: userId,
    p_token: token,
  });
}

// ─── Notification CRUD ────────────────────────────────────────

export async function fetchNotifications(
  userId: string,
  limit = 50
): Promise<AppNotification[]> {
  const { data } = await supabase.rpc("rpc_get_notifications", {
    p_user_id: userId,
    p_limit: limit,
  });
  return (data as AppNotification[] | null) ?? [];
}

export async function markNotificationRead(notificationId: string) {
  await supabase.rpc("rpc_mark_notification_read", {
    p_notification_id: notificationId,
  });
}

export async function markAllNotificationsRead(userId: string) {
  await supabase.rpc("rpc_mark_all_notifications_read", {
    p_user_id: userId,
  });
}

export async function insertNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data: Record<string, string> = {}
): Promise<AppNotification | null> {
  const { data: result } = await supabase.rpc("rpc_insert_notification", {
    p_user_id: userId,
    p_type: type,
    p_title: title,
    p_body: body,
    p_data: data,
  });
  return (result as AppNotification | null) ?? null;
}

// ─── Preferences ──────────────────────────────────────────────

export async function fetchNotificationPreferences(
  userId: string
): Promise<NotificationPreferences | null> {
  const { data } = await supabase.rpc("rpc_get_notification_preferences", {
    p_user_id: userId,
  });
  return (data as NotificationPreferences | null) ?? null;
}

export async function upsertNotificationPreferences(
  userId: string,
  prefs: NotificationPreferences
) {
  await supabase.rpc("rpc_upsert_notification_preferences", {
    p_user_id: userId,
    p_my_trades: prefs.my_trades,
    p_stop_loss: prefs.stop_loss,
    p_followed_agents: prefs.followed_agents,
    p_daily_summary: prefs.daily_summary,
  });
}

// ─── Local scheduled: daily market-close summary ──────────────

const DAILY_SUMMARY_IDENTIFIER = "agentvault-daily-summary";

export async function scheduleDailySummary() {
  if (Platform.OS === "web") return;

  try {
    await Notifications.cancelScheduledNotificationAsync(
      DAILY_SUMMARY_IDENTIFIER
    );
  } catch {}

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_SUMMARY_IDENTIFIER,
      content: {
        title: "📊 Daily P&L Summary",
        body: "Market closed. Check how your agents performed today.",
        data: { type: "daily_summary" },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 16,
        minute: 5,
      },
    });
  } catch (e) {
    console.warn("[notifications] Could not schedule daily summary:", e);
  }
}

export async function cancelDailySummary() {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(
      DAILY_SUMMARY_IDENTIFIER
    );
  } catch {}
}

// ─── Badge count ──────────────────────────────────────────────

export async function setBadgeCount(count: number) {
  if (Platform.OS === "web") return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {}
}
