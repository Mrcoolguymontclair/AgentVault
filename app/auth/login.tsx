import React, { useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  TextInput as RNTextInput,
  ActivityIndicator,
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

export default function LoginScreen() {
  const { colors, isDark } = useTheme();
  const { signIn, signInWithGoogle } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [globalError, setGlobalError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const passwordRef = useRef<RNTextInput>(null);

  function validate() {
    let valid = true;
    setEmailError("");
    setPasswordError("");
    setGlobalError("");

    if (!email.trim()) {
      setEmailError("Email is required");
      valid = false;
    } else if (!validateEmail(email)) {
      setEmailError("Enter a valid email address");
      valid = false;
    }
    if (!password) {
      setPasswordError("Password is required");
      valid = false;
    }
    return valid;
  }

  async function handleSignIn() {
    if (!validate()) return;
    setLoading(true);
    const result = await signIn(email.trim().toLowerCase(), password);
    setLoading(false);
    if (result.error) {
      setGlobalError(result.error);
    }
    // Navigation handled by AuthRouter in _layout.tsx
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    const result = await signInWithGoogle();
    setGoogleLoading(false);
    if (result.error) setGlobalError(result.error);
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top", "bottom"]}
    >
      {/* Background glow */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -80,
          right: -80,
          width: 320,
          height: 320,
          borderRadius: 160,
          backgroundColor: Colors.accent,
          opacity: isDark ? 0.07 : 0.05,
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
            {/* Branding */}
            <View style={{ alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 22,
                  backgroundColor: Colors.accentBg,
                  borderWidth: 1,
                  borderColor: Colors.accent + "40",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="flash" size={36} color={Colors.accent} />
              </View>
              <View style={{ alignItems: "center", gap: 6 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 30,
                    fontWeight: "800",
                    letterSpacing: -1,
                  }}
                >
                  Welcome back
                </Text>
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: 15,
                    textAlign: "center",
                  }}
                >
                  Sign in to your AgentVault account
                </Text>
              </View>
            </View>

            {/* Form */}
            <View style={{ gap: 16 }}>
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
                  <Ionicons
                    name="alert-circle"
                    size={18}
                    color={Colors.danger}
                    style={{ marginTop: 1 }}
                  />
                  <Text
                    style={{
                      color: Colors.danger,
                      fontSize: 14,
                      flex: 1,
                      lineHeight: 20,
                    }}
                  >
                    {globalError}
                  </Text>
                </View>
              ) : null}

              <Input
                label="Email"
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
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />

              <Input
                ref={passwordRef}
                label="Password"
                icon="lock-closed-outline"
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (passwordError) setPasswordError("");
                  if (globalError) setGlobalError("");
                }}
                error={passwordError}
                placeholder="••••••••"
                showPasswordToggle
                returnKeyType="done"
                onSubmitEditing={handleSignIn}
              />

              <Pressable
                onPress={() => router.push("/auth/forgot-password")}
                style={{ alignSelf: "flex-end" }}
              >
                <Text
                  style={{
                    color: Colors.accentLight,
                    fontWeight: "600",
                    fontSize: 13,
                  }}
                >
                  Forgot password?
                </Text>
              </Pressable>
            </View>

            {/* CTA */}
            <View style={{ gap: 14 }}>
              <Button
                variant="primary"
                size="lg"
                loading={loading}
                onPress={handleSignIn}
              >
                Sign In
              </Button>

              {/* Divider */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <View
                  style={{ flex: 1, height: 1, backgroundColor: colors.divider }}
                />
                <Text
                  style={{ color: colors.textTertiary, fontSize: 13, fontWeight: "500" }}
                >
                  or continue with
                </Text>
                <View
                  style={{ flex: 1, height: 1, backgroundColor: colors.divider }}
                />
              </View>

              {/* Google */}
              <Pressable
                onPress={handleGoogle}
                disabled={googleLoading}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  borderRadius: 14,
                  paddingVertical: 14,
                  opacity: pressed || googleLoading ? 0.7 : 1,
                })}
              >
                {googleLoading ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <>
                    <GoogleIcon />
                    <Text
                      style={{
                        color: colors.text,
                        fontWeight: "700",
                        fontSize: 15,
                      }}
                    >
                      Continue with Google
                    </Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* Footer */}
            <View
              style={{ flexDirection: "row", justifyContent: "center", gap: 5 }}
            >
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                Don't have an account?
              </Text>
              <Pressable onPress={() => router.push("/auth/signup")}>
                <Text
                  style={{
                    color: Colors.accentLight,
                    fontWeight: "700",
                    fontSize: 14,
                  }}
                >
                  Sign Up
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function GoogleIcon() {
  return (
    <View style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 18, lineHeight: 20 }}>G</Text>
    </View>
  );
}
