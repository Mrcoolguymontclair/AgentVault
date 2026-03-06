import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Colors } from "@/constants/colors";

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function ForgotPasswordScreen() {
  const { colors, isDark } = useTheme();
  const { resetPassword } = useAuthStore();

  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [globalError, setGlobalError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset() {
    setEmailError("");
    setGlobalError("");

    if (!email.trim()) {
      setEmailError("Email is required");
      return;
    }
    if (!validateEmail(email)) {
      setEmailError("Enter a valid email address");
      return;
    }

    setLoading(true);
    const result = await resetPassword(email.trim().toLowerCase());
    setLoading(false);

    if (result.error) {
      setGlobalError(result.error);
    } else {
      setSent(true);
    }
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top", "bottom"]}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 100,
          left: -80,
          width: 260,
          height: 260,
          borderRadius: 130,
          backgroundColor: Colors.accent,
          opacity: isDark ? 0.06 : 0.04,
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ paddingHorizontal: 24, paddingVertical: 32, gap: 32 }}>
            {/* Back */}
            <Pressable
              onPress={() => router.back()}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
              }}
            >
              <Ionicons name="arrow-back" size={18} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, fontWeight: "600", fontSize: 14 }}>
                Back to Sign In
              </Text>
            </Pressable>

            {sent ? (
              /* Success State */
              <View style={{ alignItems: "center", gap: 20, paddingVertical: 24 }}>
                <View
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 24,
                    backgroundColor: Colors.successBg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="mail-open-outline" size={40} color={Colors.success} />
                </View>

                <View style={{ alignItems: "center", gap: 8 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 26,
                      fontWeight: "800",
                      letterSpacing: -0.8,
                      textAlign: "center",
                    }}
                  >
                    Check your inbox
                  </Text>
                  <Text
                    style={{
                      color: colors.textSecondary,
                      fontSize: 15,
                      textAlign: "center",
                      lineHeight: 22,
                    }}
                  >
                    We sent a password reset link to{"\n"}
                    <Text style={{ color: Colors.accentLight, fontWeight: "600" }}>
                      {email}
                    </Text>
                  </Text>
                </View>

                <View
                  style={{
                    backgroundColor: Colors.successBg,
                    borderRadius: 12,
                    padding: 14,
                    width: "100%",
                    gap: 6,
                  }}
                >
                  {[
                    "Check your spam/junk folder",
                    "The link expires in 1 hour",
                    "You can request a new link if needed",
                  ].map((tip) => (
                    <View
                      key={tip}
                      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                    >
                      <Ionicons name="checkmark-circle" size={15} color={Colors.success} />
                      <Text
                        style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}
                      >
                        {tip}
                      </Text>
                    </View>
                  ))}
                </View>

                <Button
                  variant="ghost"
                  size="md"
                  onPress={() => {
                    setSent(false);
                    setEmail("");
                  }}
                >
                  Send to a different email
                </Button>

                <Button variant="primary" size="lg" onPress={() => router.back()}>
                  Back to Sign In
                </Button>
              </View>
            ) : (
              /* Form State */
              <>
                <View style={{ gap: 8 }}>
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 20,
                      backgroundColor: Colors.accentBg,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 4,
                    }}
                  >
                    <Ionicons name="key-outline" size={30} color={Colors.accentLight} />
                  </View>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 28,
                      fontWeight: "800",
                      letterSpacing: -0.8,
                    }}
                  >
                    Reset password
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 22 }}>
                    Enter your email address and we'll send you a link to reset your password.
                  </Text>
                </View>

                {globalError ? (
                  <View
                    style={{
                      backgroundColor: Colors.dangerBg,
                      borderRadius: 12,
                      padding: 14,
                      flexDirection: "row",
                      alignItems: "flex-start",
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

                <Input
                  label="Email address"
                  icon="mail-outline"
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (emailError) setEmailError("");
                    if (globalError) setGlobalError("");
                  }}
                  error={emailError}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  returnKeyType="done"
                  onSubmitEditing={handleReset}
                />

                <Button
                  variant="primary"
                  size="lg"
                  loading={loading}
                  onPress={handleReset}
                >
                  Send Reset Link
                </Button>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
