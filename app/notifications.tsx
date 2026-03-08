import React, { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { Colors } from "@/constants/colors";
import type { AppNotification } from "@/lib/services/notificationService";

// ─── Group notifications by date ──────────────────────────────
function groupByDate(
  notifications: AppNotification[]
): { title: string; data: AppNotification[] }[] {
  const groups: Map<string, AppNotification[]> = new Map();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const n of notifications) {
    const d = new Date(n.created_at).toDateString();
    let label: string;
    if (d === today) label = "Today";
    else if (d === yesterday) label = "Yesterday";
    else {
      label = new Date(n.created_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      });
    }
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(n);
  }

  return Array.from(groups.entries()).map(([title, data]) => ({
    title,
    data,
  }));
}

// ─── Flat list items with section headers ─────────────────────
type ListItem =
  | { kind: "header"; title: string }
  | { kind: "notification"; notification: AppNotification };

function buildListItems(
  notifications: AppNotification[]
): ListItem[] {
  const groups = groupByDate(notifications);
  const items: ListItem[] = [];
  for (const g of groups) {
    items.push({ kind: "header", title: g.title });
    for (const n of g.data) {
      items.push({ kind: "notification", notification: n });
    }
  }
  return items;
}

export default function NotificationsScreen() {
  const { colors, isDark } = useTheme();
  const { user } = useAuthStore();
  const { notifications, unreadCount, isLoading, markRead, markAllRead } =
    useNotificationStore();

  const listItems = buildListItems(notifications);

  const handlePress = useCallback(
    (n: AppNotification) => {
      if (!n.read) markRead(n.id);
      const agentId = n.data?.agent_id;
      if (agentId) {
        router.push(`/agent/${agentId}` as any);
      }
    },
    [markRead]
  );

  const handleMarkAllRead = useCallback(() => {
    if (user?.id) markAllRead(user.id);
  }, [user?.id, markAllRead]);

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.kind === "header") {
      return (
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 20,
            paddingBottom: 8,
          }}
        >
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 11,
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {item.title}
          </Text>
        </View>
      );
    }
    return (
      <NotificationItem notification={item.notification} onPress={handlePress} />
    );
  };

  const keyExtractor = (item: ListItem) =>
    item.kind === "header" ? `header-${item.title}` : item.notification.id;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top"]}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.divider,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: colors.cardSecondary,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: colors.cardBorder,
            opacity: pressed ? 0.7 : 1,
            marginRight: 12,
          })}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: 20,
              fontWeight: "800",
              letterSpacing: -0.5,
            }}
          >
            Notifications
          </Text>
          {unreadCount > 0 && (
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
              {unreadCount} unread
            </Text>
          )}
        </View>

        {unreadCount > 0 && (
          <Pressable
            onPress={handleMarkAllRead}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 10,
              backgroundColor: Colors.accentBg,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                color: Colors.accentLight,
                fontSize: 13,
                fontWeight: "700",
              }}
            >
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      {/* Content */}
      {isLoading ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : notifications.length === 0 ? (
        <EmptyState colors={colors} />
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => (
            <View
              style={{
                height: 1,
                backgroundColor: colors.divider,
                marginLeft: 70,
                marginRight: 16,
              }}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function EmptyState({ colors }: { colors: any }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 40,
        gap: 16,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 22,
          backgroundColor: Colors.accentBg,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: `${Colors.accent}20`,
        }}
      >
        <Ionicons name="notifications-outline" size={36} color={Colors.accent} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontSize: 20,
          fontWeight: "800",
          letterSpacing: -0.5,
          textAlign: "center",
        }}
      >
        No notifications yet
      </Text>
      <Text
        style={{
          color: colors.textSecondary,
          fontSize: 14,
          lineHeight: 22,
          textAlign: "center",
        }}
      >
        When your agents trade or hit targets, you'll see alerts here.
      </Text>
    </View>
  );
}
