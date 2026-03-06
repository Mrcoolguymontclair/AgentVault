import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "./Button";
import { useTheme } from "@/hooks/useTheme";

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  ctaLabel?: string;
  onCta?: () => void;
  secondaryCtaLabel?: string;
  onSecondaryCta?: () => void;
}

export function EmptyState({
  icon = "cube-outline",
  title,
  description,
  ctaLabel,
  onCta,
  secondaryCtaLabel,
  onSecondaryCta,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 60,
        paddingHorizontal: 32,
        gap: 16,
      }}
    >
      <View
        style={{
          width: 88,
          height: 88,
          borderRadius: 24,
          backgroundColor: colors.accentBg,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 4,
        }}
      >
        <Ionicons name={icon} size={40} color={colors.accentLight} />
      </View>

      <Text
        style={{
          color: colors.text,
          fontSize: 20,
          fontWeight: "700",
          textAlign: "center",
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>

      <Text
        style={{
          color: colors.textSecondary,
          fontSize: 15,
          textAlign: "center",
          lineHeight: 22,
        }}
      >
        {description}
      </Text>

      {ctaLabel && onCta && (
        <View style={{ marginTop: 8, width: "100%", gap: 10 }}>
          <Button variant="primary" size="md" onPress={onCta}>
            {ctaLabel}
          </Button>
          {secondaryCtaLabel && onSecondaryCta && (
            <Button variant="ghost" size="md" onPress={onSecondaryCta}>
              {secondaryCtaLabel}
            </Button>
          )}
        </View>
      )}
    </View>
  );
}
