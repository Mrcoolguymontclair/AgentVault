import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";
import type { AppNotification, NotificationType } from "@/lib/services/notificationService";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function iconForType(type: NotificationType): {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
} {
  switch (type) {
    case "trade":
      return {
        name: "flash-outline",
        color: Colors.accentLight,
        bg: Colors.accentBg,
      };
    case "stop_loss":
      return {
        name: "shield-checkmark-outline",
        color: Colors.danger,
        bg: Colors.dangerBg,
      };
    case "followed_trade":
      return {
        name: "people-outline",
        color: Colors.success,
        bg: Colors.successBg,
      };
    case "daily_summary":
      return {
        name: "bar-chart-outline",
        color: Colors.gold,
        bg: "rgba(255,212,59,0.12)",
      };
    case "welcome":
      return {
        name: "rocket-outline",
        color: Colors.accentLight,
        bg: Colors.accentBg,
      };
  }
}

interface Props {
  notification: AppNotification;
  onPress: (n: AppNotification) => void;
}

export function NotificationItem({ notification: n, onPress }: Props) {
  const { colors } = useTheme();
  const { name, color, bg } = iconForType(n.type);

  return (
    <Pressable
      onPress={() => onPress(n)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: n.read
          ? colors.card
          : (colors.cardSecondary + (colors.card === "#FFFFFF" ? "" : "")),
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {/* Icon */}
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: `${color}25`,
          flexShrink: 0,
        }}
      >
        <Ionicons name={name} size={20} color={color} />
      </View>

      {/* Content */}
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 14,
            fontWeight: n.read ? "500" : "700",
            lineHeight: 20,
          }}
          numberOfLines={1}
        >
          {n.title}
        </Text>
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            lineHeight: 18,
          }}
          numberOfLines={2}
        >
          {n.body}
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>
          {timeAgo(n.created_at)}
        </Text>
      </View>

      {/* Unread dot */}
      {!n.read && (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: Colors.accent,
            marginTop: 6,
            flexShrink: 0,
          }}
        />
      )}
    </Pressable>
  );
}
