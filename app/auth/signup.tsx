import React, { useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  TextInput as RNTextInput,
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

function getPasswordStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  if (!password) return { score: 0, label: "", color: "" };
  if (password.length < 8) return { score: 1, label: "Too short", color: Colors.danger };

  let score = 1;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { score: 2, label: "Weak", color: Colors.warning };
  if (score === 3) return { score: 3, label: "Fair", color: "#FACC15" };
  return { score: 4, label: "Strong", color: Colors.success };
}

export default function SignUpScreen() {
  const { colors, isDark } = useTheme();
  const { signUp, signInWithGoogle } = useAuthStore();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [globalError, setGlobalError] = useState("");
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<RNTextInput>(null);
  const passwordRef = useRef<RNTextInput>(null);
  const confirmRef = useRef<RNTextInput>(null);

  const strength = getPasswordStrength(password);

  function validate() {
    let valid = true;
    setNameError("");
    setEmailError("");
    setPasswordError("");
    setConfirmError("");
    setGlobalError("");

    if (!displayName.trim() || displayName.trim().length < 2) {
      setNameError("Display name must be at least 2 characters");
      valid = false;
    }
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
    } else if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      valid = false;
    }
    if (password && confirmPassword !== password) {
      setConfirmError("Passwords do not match");
      valid = false;
    }
    return valid;
  }

  async function handleSignUp() {
    if (!validate()) return;
    setLoading(true);
    const result = await signUp(
      email.trim().toLowerCase(),
      password,
      displayName.trim()
    );
    setLoading(false);
    if (result.error) {
      setGlobalError(result.error);
    }
    // AuthRouter handles navigation on success
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
          bottom: -100,
          left: -60,
          width: 300,
          height: 300,
          borderRadius: 150,
          backgroundColor: Colors.accent,
          opacity: isDark ? 0.06 : 0.04,
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 32, gap: 28 }}>
            {/* Back + Header */}
            <View style={{ gap: 20 }}>
              <Pressable
                onPress={() => router.back()}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  alignSelf: "flex-start",
                }}
              >
                <Ionicons
                  name="arrow-back"
                  size={18}
                  color={colors.textSecondary}
                />
                <Text
                  style={{ color: colors.textSecondary, fontWeight: "600", fontSize: 14 }}
                >
                  Back
                </Text>
              </Pressable>

              <View style={{ gap: 6 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 30,
                    fontWeight: "800",
                    letterSpacing: -1,
                  }}
                >
                  Create account
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 15 }}>
                  Join AgentVault and deploy your first AI trading agent
                </Text>
              </View>
            </View>

            {/* Global Error */}
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

            {/* Form */}
            <View style={{ gap: 16 }}>
              <Input
                label="Display Name"
                icon="person-outline"
                value={displayName}
                onChangeText={(t) => {
                  setDisplayName(t);
                  if (nameError) setNameError("");
                }}
                error={nameError}
                placeholder="Your name"
                autoCapitalize="words"
                autoComplete="name"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
              />

              <Input
                ref={emailRef}
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

              {/* Password with strength meter */}
              <View style={{ gap: 0 }}>
                <Input
                  ref={passwordRef}
                  label="Password"
                  icon="lock-closed-outline"
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    if (passwordError) setPasswordError("");
                  }}
                  error={passwordError}
                  placeholder="Min. 8 characters"
                  showPasswordToggle
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                />

                {/* Strength meter */}
                {password.length > 0 && (
                  <View style={{ marginTop: 10, gap: 6 }}>
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      {[1, 2, 3, 4].map((i) => (
                        <View
                          key={i}
                          style={{
                            flex: 1,
                            height: 3,
                            borderRadius: 2,
                            backgroundColor:
                              i <= strength.score
                                ? strength.color
                                : colors.cardBorder,
                          }}
                        />
                      ))}
                    </View>
                    {strength.label ? (
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color: strength.color,
                        }}
                      >
                        {strength.label} password
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>

              <Input
                ref={confirmRef}
                label="Confirm Password"
                icon="shield-checkmark-outline"
                value={confirmPassword}
                onChangeText={(t) => {
                  setConfirmPassword(t);
                  if (confirmError) setConfirmError("");
                }}
                error={confirmError}
                placeholder="Re-enter your password"
                showPasswordToggle
                returnKeyType="done"
                onSubmitEditing={handleSignUp}
              />
            </View>

            {/* CTA */}
            <View style={{ gap: 14 }}>
              <Button
                variant="primary"
                size="lg"
                loading={loading}
                onPress={handleSignUp}
              >
                Create Account
              </Button>

              {/* Divider */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
                <Text style={{ color: colors.textTertiary, fontSize: 13, fontWeight: "500" }}>
                  or continue with
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
              </View>

              <Pressable
                onPress={signInWithGoogle}
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
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 18 }}>G</Text>
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
                  Continue with Google
                </Text>
              </Pressable>
            </View>

            {/* Terms */}
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 12,
                textAlign: "center",
                lineHeight: 18,
              }}
            >
              By creating an account, you agree to our{" "}
              <Text style={{ color: Colors.accentLight }}>Terms of Service</Text>
              {" "}and{" "}
              <Text style={{ color: Colors.accentLight }}>Privacy Policy</Text>
            </Text>

            {/* Footer */}
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 5 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                Already have an account?
              </Text>
              <Pressable onPress={() => router.back()}>
                <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 14 }}>
                  Sign In
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
