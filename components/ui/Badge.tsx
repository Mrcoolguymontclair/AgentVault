import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors } from "@/constants/colors";

type BadgeVariant = "accent" | "success" | "danger" | "warning" | "neutral" | "live" | "paper";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  dot?: boolean;
}

const variantMap: Record<BadgeVariant, { bg: string; text: string; dot?: string }> = {
  accent: { bg: "rgba(108,92,231,0.15)", text: Colors.accentLight },
  success: { bg: Colors.successBg, text: Colors.success },
  danger: { bg: Colors.dangerBg, text: Colors.danger },
  warning: { bg: Colors.warningBg, text: Colors.warning },
  neutral: { bg: "rgba(139,143,168,0.15)", text: "#8B8FA8" },
  live: { bg: "rgba(0,214,143,0.12)", text: Colors.success, dot: Colors.success },
  paper: { bg: "rgba(139,143,168,0.12)", text: "#8B8FA8", dot: "#8B8FA8" },
};

export function Badge({ label, variant = "neutral", size = "sm", dot }: BadgeProps) {
  const vs = variantMap[variant];
  const isSmall = size === "sm";

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: vs.bg,
        paddingHorizontal: isSmall ? 8 : 12,
        paddingVertical: isSmall ? 3 : 5,
        borderRadius: 100,
        gap: 5,
        alignSelf: "flex-start",
      }}
    >
      {(dot || vs.dot) && (
        <View
          style={{
            width: isSmall ? 5 : 6,
            height: isSmall ? 5 : 6,
            borderRadius: 100,
            backgroundColor: vs.dot || vs.text,
          }}
        />
      )}
      <Text
        style={{
          color: vs.text,
          fontSize: isSmall ? 11 : 13,
          fontWeight: "700",
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
