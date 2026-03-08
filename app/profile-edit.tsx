import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Colors } from "@/constants/colors";

const AVATAR_OPTIONS = [
  "🚀", "🤖", "🦅", "🐉", "🦁", "🐺", "🦊", "🐻",
  "🐯", "🦋", "🌊", "⚡", "🔥", "💎", "🌙", "⭐",
  "🎯", "🏆", "💡", "🔮", "🛡️", "⚔️", "🎲", "🧠",
  "🌿", "🦄", "🐬", "🦝", "🦚", "🎪",
];

export default function ProfileEditScreen() {
  const { colors } = useTheme();
  const { user: authUser, updateProfile } = useAuthStore();

  const [displayName, setDisplayName] = useState(
    authUser?.user_metadata?.display_name ?? ""
  );
  const [avatar, setAvatar] = useState(
    authUser?.user_metadata?.avatar ?? "🚀"
  );
  const [isSaving, setIsSaving] = useState(false);

  const hasChanges =
    displayName !== (authUser?.user_metadata?.display_name ?? "") ||
    avatar !== (authUser?.user_metadata?.avatar ?? "🚀");

  async function handleSave() {
    if (!displayName.trim()) {
      Alert.alert("Display Name Required", "Please enter a display name.");
      return;
    }
    setIsSaving(true);
    const result = await updateProfile({
      displayName: displayName.trim(),
      avatar,
      tradingLevel: authUser?.user_metadata?.trading_level ?? "beginner",
    });
    setIsSaving(false);

    if (result.error) {
      Alert.alert("Error", result.error);
    } else {
      router.back();
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.cardBorder,
            gap: 12,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              backgroundColor: colors.cardSecondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>
          <Text style={{ flex: 1, color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 }}>
            Edit Profile
          </Text>
          {hasChanges && (
            <Pressable onPress={handleSave} hitSlop={8}>
              <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 15 }}>Save</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, gap: 28, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar preview */}
          <View style={{ alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 28,
                backgroundColor: Colors.accentBg,
                borderWidth: 3,
                borderColor: Colors.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 48 }}>{avatar}</Text>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
              Tap an emoji below to change your avatar
            </Text>
          </View>

          {/* Emoji grid */}
          <View style={{ gap: 10 }}>
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 11,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Choose Avatar
            </Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                padding: 14,
              }}
            >
              {AVATAR_OPTIONS.map((emoji) => {
                const selected = avatar === emoji;
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => setAvatar(emoji)}
                    style={({ pressed }) => ({
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      backgroundColor: selected
                        ? Colors.accentBg
                        : pressed
                        ? colors.cardSecondary
                        : colors.cardSecondary,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? Colors.accent : colors.cardBorder,
                      alignItems: "center",
                      justifyContent: "center",
                    })}
                  >
                    <Text style={{ fontSize: 26 }}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Display name */}
          <View style={{ gap: 10 }}>
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 11,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Display Name
            </Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Enter your display name..."
              placeholderTextColor={colors.textTertiary}
              maxLength={32}
              style={{
                backgroundColor: colors.card,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: colors.text,
                fontSize: 16,
                fontWeight: "600",
              }}
            />
            <Text style={{ color: colors.textTertiary, fontSize: 12, paddingLeft: 4 }}>
              {displayName.length}/32 characters
            </Text>
          </View>

          {/* Email (read-only) */}
          <View style={{ gap: 10 }}>
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 11,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              Email
            </Text>
            <View
              style={{
                backgroundColor: colors.cardSecondary,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                paddingHorizontal: 16,
                paddingVertical: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Ionicons name="mail-outline" size={16} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontSize: 15 }}>
                {authUser?.email ?? "—"}
              </Text>
              <View style={{ marginLeft: "auto" }}>
                <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Read-only</Text>
              </View>
            </View>
          </View>

          <Button
            variant="primary"
            size="lg"
            onPress={handleSave}
            loading={isSaving}
            disabled={!hasChanges || !displayName.trim()}
          >
            Save Changes
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
