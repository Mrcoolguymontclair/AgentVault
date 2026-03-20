import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import {
  fetchNotifications,
  fetchNotificationPreferences,
  markNotificationRead,
  markAllNotificationsRead,
  upsertNotificationPreferences,
  insertNotification,
  setBadgeCount,
  scheduleDailySummary,
  cancelDailySummary,
  type AppNotification,
  type NotificationPreferences,
  DEFAULT_PREFERENCES,
} from "@/lib/services/notificationService";

interface NotificationStore {
  notifications: AppNotification[];
  unreadCount: number;
  preferences: NotificationPreferences;
  hasPermission: boolean;
  showPermissionModal: boolean;
  isLoading: boolean;
  error: string | null;

  // Setters
  setHasPermission: (val: boolean) => void;
  setShowPermissionModal: (val: boolean) => void;
  clearError: () => void;

  // Data actions
  initialize: (userId: string) => Promise<void>;
  loadNotifications: (userId: string) => Promise<void>;
  loadPreferences: (userId: string) => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: (userId: string) => Promise<void>;
  updatePreferences: (
    userId: string,
    partial: Partial<NotificationPreferences>
  ) => Promise<void>;
  addNotification: (n: AppNotification) => void;

  // High-level triggers
  sendWelcomeNotification: (userId: string, agentName: string) => Promise<void>;
  sendTradeNotification: (
    userId: string,
    agentName: string,
    symbol: string,
    side: string,
    pnl: number,
    agentId: string
  ) => Promise<void>;

  // Realtime
  subscribeToRealtime: (userId: string) => () => void;

  // Cleanup
  reset: () => void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  preferences: DEFAULT_PREFERENCES,
  hasPermission: false,
  showPermissionModal: false,
  isLoading: false,
  error: null,

  setHasPermission: (val) => set({ hasPermission: val }),
  setShowPermissionModal: (val) => set({ showPermissionModal: val }),
  clearError: () => set({ error: null }),

  initialize: async (userId) => {
    await Promise.all([
      get().loadNotifications(userId),
      get().loadPreferences(userId),
    ]);
  },

  loadNotifications: async (userId) => {
    set({ isLoading: true, error: null });
    try {
      const notifications = await fetchNotifications(userId, 50);
      const unreadCount = notifications.filter((n) => !n.read).length;
      set({ notifications, unreadCount, isLoading: false });
      setBadgeCount(unreadCount);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load notifications";
      set({ isLoading: false, error: message });
    }
  },

  loadPreferences: async (userId) => {
    const prefs = await fetchNotificationPreferences(userId);
    if (prefs) set({ preferences: prefs });
  },

  markRead: async (notificationId) => {
    await markNotificationRead(notificationId);
    set((state) => {
      const notifications = state.notifications.map((n) =>
        n.id === notificationId ? { ...n, read: true } : n
      );
      const unreadCount = notifications.filter((n) => !n.read).length;
      setBadgeCount(unreadCount);
      return { notifications, unreadCount };
    });
  },

  markAllRead: async (userId) => {
    await markAllNotificationsRead(userId);
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
    setBadgeCount(0);
  },

  updatePreferences: async (userId, partial) => {
    const current = get().preferences;
    const prefs = { ...current, ...partial };
    set({ preferences: prefs });
    await upsertNotificationPreferences(userId, prefs);

    // Schedule or cancel daily summary based on preference
    if (prefs.daily_summary && get().hasPermission) {
      scheduleDailySummary();
    } else {
      cancelDailySummary();
    }
  },

  addNotification: (n) => {
    set((state) => {
      const notifications = [n, ...state.notifications];
      const unreadCount = notifications.filter((x) => !x.read).length;
      setBadgeCount(unreadCount);
      return { notifications, unreadCount };
    });
  },

  sendWelcomeNotification: async (userId, agentName) => {
    const n = await insertNotification(
      userId,
      "welcome",
      "🚀 Agent Deployed!",
      `${agentName} is live and scanning the market.`,
      {}
    );
    if (n) get().addNotification(n);
  },

  sendTradeNotification: async (userId, agentName, symbol, side, pnl, agentId) => {
    const { preferences } = get();
    if (!preferences.my_trades) return;

    const isProfit = pnl >= 0;
    const pnlStr = `${isProfit ? "+" : ""}$${Math.abs(pnl).toFixed(2)}`;
    const n = await insertNotification(
      userId,
      "trade",
      `${isProfit ? "📈" : "📉"} ${agentName} — ${side.toUpperCase()} ${symbol}`,
      `Trade executed · P&L: ${pnlStr}`,
      { agent_id: agentId, symbol, side }
    );
    if (n) get().addNotification(n);
  },

  subscribeToRealtime: (userId) => {
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Only add if not already in store (avoid duplicates from local inserts)
          const incoming = payload.new as AppNotification;
          const exists = get().notifications.some((n) => n.id === incoming.id);
          if (!exists) get().addNotification(incoming);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  reset: () =>
    set({
      notifications: [],
      unreadCount: 0,
      preferences: DEFAULT_PREFERENCES,
      hasPermission: false,
      error: null,
    }),
}));
