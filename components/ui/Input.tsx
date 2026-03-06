import React, { forwardRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  Pressable,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/colors";

interface InputProps extends TextInputProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  error?: string;
  hint?: string;
  showPasswordToggle?: boolean;
  rightElement?: React.ReactNode;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    icon,
    error,
    hint,
    showPasswordToggle,
    rightElement,
    secureTextEntry,
    style,
    ...props
  },
  ref
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const borderColor = error
    ? Colors.danger
    : focused
    ? Colors.accent
    : colors.cardBorder;

  const isSecure = showPasswordToggle ? !showPassword : secureTextEntry;

  return (
    <View style={{ gap: 7 }}>
      <Text
        style={{
          color: colors.textSecondary,
          fontSize: 13,
          fontWeight: "600",
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.inputBg,
          borderRadius: 14,
          borderWidth: focused ? 1.5 : 1,
          borderColor,
          paddingHorizontal: 14,
          gap: 10,
        }}
      >
        {icon && (
          <Ionicons
            name={icon}
            size={18}
            color={
              error
                ? Colors.danger
                : focused
                ? Colors.accentLight
                : colors.textTertiary
            }
          />
        )}

        <TextInput
          ref={ref}
          style={[
            {
              flex: 1,
              color: colors.text,
              fontSize: 16,
              paddingVertical: 14,
              fontWeight: "400",
              outlineStyle: "none",
            } as any,
            style,
          ]}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={isSecure}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />

        {showPasswordToggle && (
          <Pressable
            onPress={() => setShowPassword(!showPassword)}
            hitSlop={10}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={18}
              color={colors.textTertiary}
            />
          </Pressable>
        )}

        {rightElement}
      </View>

      {error ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="alert-circle-outline" size={13} color={Colors.danger} />
          <Text
            style={{ color: Colors.danger, fontSize: 12, fontWeight: "500", flex: 1 }}
          >
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 17 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
