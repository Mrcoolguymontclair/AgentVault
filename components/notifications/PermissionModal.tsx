import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  Animated,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";

interface Props {
  visible: boolean;
  onAllow: () => void;
  onSkip: () => void;
}

const NOTIFICATION_PREVIEWS = [
  {
    icon: "flash-outline" as const,
    iconColor: Colors.accentLight,
    iconBg: Colors.accentBg,
    title: "NVDA — BUY executed",
    body: "Alpha Scalper · +$142.50",
    time: "now",
  },
  {
    icon: "shield-checkmark-outline" as const,
    iconColor: Colors.success,
    iconBg: Colors.successBg,
    title: "Take profit hit 🎯",
    body: "Momentum Rider exited TSLA +12.3%",
    time: "4:05 PM",
  },
  {
    icon: "trophy-outline" as const,
    iconColor: Colors.gold,
    iconBg: "rgba(255,212,59,0.12)",
    title: "📊 Daily P&L Summary",
    body: "Your agents earned +$891 today",
    time: "4:05 PM",
  },
];

export function PermissionModal({ visible, onAllow, onSkip }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(600)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 24,
          stiffness: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 600,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (Platform.OS === "web") return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "flex-end",
          opacity: fadeAnim,
        }}
      >
        {/* Sheet */}
        <Animated.View
          style={{
            backgroundColor: colors.card,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: insets.bottom + 24,
            transform: [{ translateY: slideAnim }],
          }}
        >
          {/* Drag handle */}
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.divider,
              alignSelf: "center",
              marginBottom: 28,
            }}
          />

          {/* Bell icon */}
          <View style={{ alignItems: "center", marginBottom: 20 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 24,
                backgroundColor: Colors.accentBg,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: `${Colors.accent}30`,
              }}
            >
              <Ionicons name="notifications" size={40} color={Colors.accent} />
            </View>
          </View>

          {/* Title */}
          <Text
            style={{
              color: colors.text,
              fontSize: 24,
              fontWeight: "800",
              letterSpacing: -0.6,
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Stay in the Loop
          </Text>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 15,
              lineHeight: 22,
              textAlign: "center",
              marginBottom: 28,
              paddingHorizontal: 8,
            }}
          >
            Get real-time alerts when your agents trade, hit profit targets, or
            when the market closes.
          </Text>

          {/* Preview notifications */}
          <View
            style={{
              gap: 8,
              marginBottom: 28,
              padding: 12,
              backgroundColor: isDark ? colors.cardSecondary : colors.background,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.cardBorder,
            }}
          >
            {NOTIFICATION_PREVIEWS.map((item, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 4,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: item.iconBg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={item.icon} size={18} color={item.iconColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 13,
                      fontWeight: "600",
                    }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={{
                      color: colors.textSecondary,
                      fontSize: 12,
                      marginTop: 1,
                    }}
                  >
                    {item.body}
                  </Text>
                </View>
                <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                  {item.time}
                </Text>
              </View>
            ))}
          </View>

          {/* Allow button */}
          <Pressable
            onPress={onAllow}
            style={({ pressed }) => ({
              backgroundColor: Colors.accent,
              borderRadius: 16,
              paddingVertical: 18,
              alignItems: "center",
              marginBottom: 12,
              opacity: pressed ? 0.85 : 1,
              shadowColor: Colors.accent,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.4,
              shadowRadius: 12,
              elevation: 6,
            })}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontWeight: "800",
                fontSize: 17,
                letterSpacing: 0.2,
              }}
            >
              Allow Notifications
            </Text>
          </Pressable>

          {/* Skip */}
          <Pressable
            onPress={onSkip}
            style={({ pressed }) => ({
              alignItems: "center",
              padding: 10,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Text
              style={{
                color: colors.textTertiary,
                fontWeight: "600",
                fontSize: 15,
              }}
            >
              Not Now
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
