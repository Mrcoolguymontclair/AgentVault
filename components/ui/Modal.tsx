import React from "react";
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "./Button";

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  primaryAction?: { label: string; onPress: () => void; loading?: boolean; destructive?: boolean };
  secondaryAction?: { label: string; onPress: () => void };
  size?: "sm" | "md" | "lg" | "full";
  scrollable?: boolean;
}

export function Modal({
  visible,
  onClose,
  title,
  subtitle,
  children,
  primaryAction,
  secondaryAction,
  size = "md",
  scrollable = true,
}: ModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const maxHeight = { sm: "40%", md: "60%", lg: "85%", full: "95%" }[size];

  const Content = (
    <View
      style={{
        backgroundColor: colors.card,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        maxHeight: maxHeight as any,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: colors.cardBorder,
      }}
    >
      {/* Drag Handle */}
      <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
        <View
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: colors.divider,
          }}
        />
      </View>

      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.divider,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: 18,
              fontWeight: "700",
              letterSpacing: -0.3,
            }}
          >
            {title}
          </Text>
          {subtitle && (
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
              {subtitle}
            </Text>
          )}
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: colors.cardBorder,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Body */}
      {scrollable ? (
        <ScrollView
          style={{ paddingHorizontal: 20 }}
          contentContainerStyle={{ paddingVertical: 20, gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ paddingHorizontal: 20, paddingVertical: 20, gap: 16 }}>
          {children}
        </View>
      )}

      {/* Footer */}
      {(primaryAction || secondaryAction) && (
        <View
          style={{
            flexDirection: "row",
            gap: 12,
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
            borderTopWidth: 1,
            borderTopColor: colors.divider,
          }}
        >
          {secondaryAction && (
            <View style={{ flex: 1 }}>
              <Button variant="ghost" size="md" onPress={secondaryAction.onPress}>
                {secondaryAction.label}
              </Button>
            </View>
          )}
          {primaryAction && (
            <View style={{ flex: 1 }}>
              <Button
                variant={primaryAction.destructive ? "danger" : "primary"}
                size="md"
                onPress={primaryAction.onPress}
                loading={primaryAction.loading}
              >
                {primaryAction.label}
              </Button>
            </View>
          )}
        </View>
      )}
    </View>
  );

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
          onPress={onClose}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>{Content}</Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </RNModal>
  );
}
