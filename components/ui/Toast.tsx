import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, Animated, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useToastStore, type Toast } from "@/store/toastStore";

const TYPE_CONFIG = {
  success: {
    bg: "#0D2E1A",
    border: "#22C55E40",
    text: "#22C55E",
    icon: "checkmark-circle" as const,
  },
  error: {
    bg: "#2D1114",
    border: "#EF444440",
    text: "#EF4444",
    icon: "alert-circle" as const,
  },
  info: {
    bg: "#0D1A2D",
    border: "#3B82F640",
    text: "#3B82F6",
    icon: "information-circle" as const,
  },
};

function ToastItem({ toast }: { toast: Toast }) {
  const { dismissToast } = useToastStore();
  const cfg = TYPE_CONFIG[toast.type];
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== "web" }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Pressable
        onPress={() => dismissToast(toast.id)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: cfg.bg,
          borderWidth: 1,
          borderColor: cfg.border,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 12,
          gap: 10,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <Ionicons name={cfg.icon} size={20} color={cfg.text} />
        <Text
          style={{ color: cfg.text, fontSize: 14, fontWeight: "600", flex: 1, lineHeight: 19 }}
          numberOfLines={3}
        >
          {toast.message}
        </Text>
        <Ionicons name="close" size={16} color={cfg.text + "80"} />
      </Pressable>
    </Animated.View>
  );
}

export function ToastContainer() {
  const { toasts } = useToastStore();
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        bottom: insets.bottom + 80,
        left: 16,
        right: 16,
        gap: 8,
        zIndex: 9999,
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </View>
  );
}
