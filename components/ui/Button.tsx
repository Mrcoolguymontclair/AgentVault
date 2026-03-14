import React from "react";
import {
  Text,
  ActivityIndicator,
  PressableProps,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { Pressable } from "react-native";
import { Colors } from "@/constants/colors";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends PressableProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  children: React.ReactNode;
  accessibilityLabel?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Flat, border-driven variants — no rgba glow fills
const variantStyles: Record<Variant, { bg: string; text: string; border?: string }> = {
  primary:   { bg: Colors.accent,   text: "#FFFFFF" },
  secondary: { bg: "transparent",   text: Colors.accent,   border: Colors.accent },
  ghost:     { bg: "transparent",   text: Colors.accentLight },
  danger:    { bg: Colors.danger,   text: "#FFFFFF" },
  success:   { bg: Colors.success,  text: "#FFFFFF" },
};

const sizeStyles: Record<Size, { py: number; px: number; fontSize: number; gap: number }> = {
  sm: { py: 8,  px: 16, fontSize: 13, gap: 6  },
  md: { py: 12, px: 20, fontSize: 15, gap: 8  },
  lg: { py: 15, px: 28, fontSize: 16, gap: 10 },
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  iconPosition = "left",
  children,
  disabled,
  style,
  onPress,
  accessibilityLabel,
  ...props
}: ButtonProps) {
  const scale = useSharedValue(1);
  const vs = variantStyles[variant];
  const ss = sizeStyles[size];

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const isDisabled = disabled || loading;

  return (
    <AnimatedPressable
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === "string" ? children : undefined)}
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      onPressIn={() => {
        if (!isDisabled) scale.value = withSpring(0.96, { damping: 15, stiffness: 400 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 400 });
      }}
      onPress={isDisabled ? undefined : onPress}
      style={[
        animStyle,
        {
          backgroundColor: vs.bg,
          borderRadius: 10,
          paddingVertical: ss.py,
          paddingHorizontal: ss.px,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: ss.gap,
          opacity: isDisabled ? 0.45 : 1,
          ...(vs.border ? { borderWidth: 1, borderColor: vs.border } : {}),
        },
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={vs.text} />
      ) : (
        <>
          {icon && iconPosition === "left" && icon}
          <Text
            style={{
              color: vs.text,
              fontSize: ss.fontSize,
              fontWeight: "600",
              letterSpacing: 0.1,
            }}
          >
            {children}
          </Text>
          {icon && iconPosition === "right" && icon}
        </>
      )}
    </AnimatedPressable>
  );
}
