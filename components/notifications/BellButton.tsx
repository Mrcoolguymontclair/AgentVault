import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useNotificationStore } from "@/store/notificationStore";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";

interface Props {
  size?: number;
  accessibilityLabel?: string;
}

export function BellButton({ size = 22, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  return (
    <Pressable
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ??
        (unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications")
      }
      onPress={() => router.push("/notifications")}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: colors.cardSecondary,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: colors.cardBorder,
        opacity: pressed ? 0.7 : 1,
      })}
      hitSlop={8}
    >
      <Ionicons
        name={unreadCount > 0 ? "notifications" : "notifications-outline"}
        size={size}
        color={unreadCount > 0 ? Colors.accent : colors.textSecondary}
      />
      {unreadCount > 0 && (
        <View
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: Colors.danger,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: colors.cardSecondary,
            paddingHorizontal: 3,
          }}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 9,
              fontWeight: "800",
              lineHeight: 12,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
