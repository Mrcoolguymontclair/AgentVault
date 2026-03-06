import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Colors } from "@/constants/colors";

const AVATARS = ["🚀", "🐋", "🦅", "🤖", "⚡", "🧙", "🎯", "🌊", "🛡️", "💡", "📊", "🔥"];

const TRADING_LEVELS = [
  {
    value: "beginner",
    label: "Beginner",
    description: "New to algo trading",
    icon: "school-outline" as const,
  },
  {
    value: "intermediate",
    label: "Intermediate",
    description: "Some trading experience",
    icon: "trending-up-outline" as const,
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "Experienced trader",
    icon: "flash-outline" as const,
  },
  {
    value: "professional",
    label: "Professional",
    description: "Full-time trader or quant",
    icon: "diamond-outline" as const,
  },
];

export default function ProfileSetupScreen() {
  const { colors, isDark } = useTheme();
  const { user, updateProfile } = useAuthStore();

  const defaultName = user?.user_metadata?.display_name || "";

  const [displayName, setDisplayName] = useState(defaultName);
  const [selectedAvatar, setSelectedAvatar] = useState("🚀");
  const [tradingLevel, setTradingLevel] = useState("beginner");
  const [nameError, setNameError] = useState("");
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");

  async function handleContinue() {
    setGlobalError("");
    if (!displayName.trim() || displayName.trim().length < 2) {
      setNameError("Display name must be at least 2 characters");
      return;
    }
    setNameError("");
    setLoading(true);
    const result = await updateProfile({
      displayName: displayName.trim(),
      avatar: selectedAvatar,
      tradingLevel,
    });
    setLoading(false);
    if (result.error) {
      setGlobalError(result.error);
    }
    // AuthRouter handles navigation once profileComplete = true
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top", "bottom"]}
    >
      {/* Background accent */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -60,
          right: -60,
          width: 280,
          height: 280,
          borderRadius: 140,
          backgroundColor: Colors.accent,
          opacity: isDark ? 0.07 : 0.04,
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View style={{ paddingHorizontal: 24, paddingTop: 32, gap: 32 }}>
            {/* Header */}
            <View style={{ gap: 8 }}>
              {/* Step indicator */}
              <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
                {[1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: i === 1 ? Colors.accent : colors.cardBorder,
                    }}
                  />
                ))}
              </View>
              <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 }}>
                Step 1 of 3
              </Text>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 28,
                  fontWeight: "800",
                  letterSpacing: -0.8,
                }}
              >
                Set up your profile
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 22 }}>
                Personalize your account and tell us about your trading experience.
              </Text>
            </View>

            {/* Global Error */}
            {globalError ? (
              <View
                style={{
                  backgroundColor: Colors.dangerBg,
                  borderRadius: 12,
                  padding: 14,
                  flexDirection: "row",
                  gap: 10,
                  borderWidth: 1,
                  borderColor: Colors.danger + "40",
                }}
              >
                <Ionicons name="alert-circle" size={18} color={Colors.danger} style={{ marginTop: 1 }} />
                <Text style={{ color: Colors.danger, fontSize: 14, flex: 1, lineHeight: 20 }}>
                  {globalError}
                </Text>
              </View>
            ) : null}

            {/* Avatar Picker */}
            <View style={{ gap: 14 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                Choose your avatar
              </Text>

              {/* Selected preview */}
              <View style={{ alignItems: "center", marginBottom: 4 }}>
                <View
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 24,
                    backgroundColor: Colors.accentBg,
                    borderWidth: 2,
                    borderColor: Colors.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 42 }}>{selectedAvatar}</Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
                {AVATARS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => setSelectedAvatar(emoji)}
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      backgroundColor:
                        selectedAvatar === emoji ? Colors.accentBg : colors.cardSecondary,
                      borderWidth: selectedAvatar === emoji ? 2 : 1,
                      borderColor:
                        selectedAvatar === emoji ? Colors.accent : colors.cardBorder,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 26 }}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Display Name */}
            <Input
              label="Display Name"
              icon="person-outline"
              value={displayName}
              onChangeText={(t) => {
                setDisplayName(t);
                if (nameError) setNameError("");
              }}
              error={nameError}
              placeholder="How should we call you?"
              autoCapitalize="words"
              returnKeyType="done"
            />

            {/* Trading Level */}
            <View style={{ gap: 14 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700" }}>
                Trading experience
              </Text>

              <View style={{ gap: 10 }}>
                {TRADING_LEVELS.map((level) => {
                  const selected = tradingLevel === level.value;
                  return (
                    <Pressable
                      key={level.value}
                      onPress={() => setTradingLevel(level.value)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 14,
                        padding: 16,
                        backgroundColor: selected ? Colors.accentBg : colors.card,
                        borderRadius: 14,
                        borderWidth: selected ? 1.5 : 1,
                        borderColor: selected ? Colors.accent : colors.cardBorder,
                      }}
                    >
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 12,
                          backgroundColor: selected
                            ? Colors.accent + "25"
                            : colors.cardSecondary,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name={level.icon}
                          size={20}
                          color={selected ? Colors.accentLight : colors.textTertiary}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: selected ? Colors.accentLight : colors.text,
                            fontWeight: "700",
                            fontSize: 15,
                          }}
                        >
                          {level.label}
                        </Text>
                        <Text
                          style={{
                            color: selected ? Colors.accentLight + "AA" : colors.textSecondary,
                            fontSize: 13,
                            marginTop: 2,
                          }}
                        >
                          {level.description}
                        </Text>
                      </View>

                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          borderWidth: selected ? 0 : 1.5,
                          borderColor: colors.cardBorder,
                          backgroundColor: selected ? Colors.accent : "transparent",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {selected && (
                          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* CTA */}
            <Button
              variant="primary"
              size="lg"
              loading={loading}
              onPress={handleContinue}
            >
              Continue
            </Button>

            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 12,
                textAlign: "center",
                lineHeight: 18,
              }}
            >
              You can update these details anytime in Settings
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
