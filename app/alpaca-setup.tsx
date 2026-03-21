import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/utils/format";

interface AlpacaAccountInfo {
  status: string;
  buying_power: string;
  portfolio_value: string;
  equity: string;
  cash: string;
  account_number: string;
}

export default function AlpacaSetupScreen() {
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();

  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [existingHint, setExistingHint] = useState<string | null>(null);
  const [hasKeys, setHasKeys] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [accountInfo, setAccountInfo] = useState<AlpacaAccountInfo | null>(null);

  useEffect(() => {
    if (!authUser?.id) return;
    (async () => {
      const { data } = await supabase.rpc("rpc_get_alpaca_key_status", {
        p_user_id: authUser.id,
      });
      const result = data as { has_keys: boolean; key_id_hint: string | null } | null;
      if (result?.has_keys) {
        setHasKeys(true);
        setExistingHint(result.key_id_hint);
      }
    })();
  }, [authUser?.id]);

  async function testConnection(testKeyId: string, testKeySecret: string) {
    setIsTesting(true);
    setTestResult(null);
    setAccountInfo(null);
    try {
      // Try paper first, then live
      for (const base of [
        "https://paper-api.alpaca.markets/v2",
        "https://api.alpaca.markets/v2",
      ]) {
        try {
          const res = await fetch(`${base}/account`, {
            headers: {
              "APCA-API-KEY-ID": testKeyId,
              "APCA-API-SECRET-KEY": testKeySecret,
            },
          });
          if (res.ok) {
            const data = await res.json();
            setAccountInfo(data);
            const isLive = base.includes("api.alpaca.markets/v2") && !base.includes("paper");
            setTestResult({
              ok: true,
              message: `Connected to ${isLive ? "Live" : "Paper"} account`,
            });
            setIsTesting(false);
            return true;
          }
        } catch {
          // try next
        }
      }
      setTestResult({ ok: false, message: "Invalid API keys. Check your Key ID and Secret." });
      setIsTesting(false);
      return false;
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message ?? "Connection failed" });
      setIsTesting(false);
      return false;
    }
  }

  async function handleTestConnection() {
    if (!keyId.trim() || !keySecret.trim()) {
      Alert.alert("Missing Keys", "Enter both Key ID and Secret to test.");
      return;
    }
    await testConnection(keyId.trim(), keySecret.trim());
  }

  async function handleSave() {
    if (!keyId.trim() || !keySecret.trim()) {
      Alert.alert("Missing Keys", "Please enter both your API Key ID and Secret.");
      return;
    }
    if (!authUser?.id) return;
    setIsSaving(true);
    try {
      // Test first if not already tested
      if (!testResult?.ok) {
        const ok = await testConnection(keyId.trim(), keySecret.trim());
        if (!ok) {
          setIsSaving(false);
          return;
        }
      }

      const { error } = await supabase.rpc("rpc_save_alpaca_keys", {
        p_user_id: authUser.id,
        p_key_id: keyId.trim(),
        p_key_secret: keySecret.trim(),
      });
      if (error) throw error;
      setIsSaving(false);
      setHasKeys(true);
      setExistingHint(keyId.trim().slice(0, 8) + "...");
      Alert.alert("Keys Saved", "Your Alpaca API keys have been saved securely.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      setIsSaving(false);
      Alert.alert("Error", e?.message ?? "Failed to save keys. Please try again.");
    }
  }

  async function handleRemove() {
    Alert.alert(
      "Remove API Keys",
      "Your Alpaca API keys will be deleted. Live trading will be disabled.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            if (!authUser?.id) return;
            setIsSaving(true);
            await supabase.rpc("rpc_save_alpaca_keys", {
              p_user_id: authUser.id,
              p_key_id: "",
              p_key_secret: "",
            });
            setIsSaving(false);
            setHasKeys(false);
            setExistingHint(null);
            setKeyId("");
            setKeySecret("");
            setAccountInfo(null);
            setTestResult(null);
          },
        },
      ]
    );
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
            Alpaca API Keys
          </Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Status banner */}
          {hasKeys ? (
            <View
              style={{
                backgroundColor: Colors.successBg,
                borderRadius: 14,
                padding: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderWidth: 1,
                borderColor: Colors.success,
              }}
            >
              <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.success, fontWeight: "700", fontSize: 14 }}>
                  API Keys Connected
                </Text>
                {existingHint && (
                  <Text style={{ color: Colors.success, fontSize: 12, marginTop: 2, opacity: 0.8 }}>
                    Key ID: {existingHint}
                  </Text>
                )}
              </View>
              <Pressable onPress={handleRemove} hitSlop={8}>
                <Text style={{ color: Colors.danger, fontWeight: "700", fontSize: 13 }}>Remove</Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={{
                backgroundColor: "rgba(255,169,77,0.10)",
                borderRadius: 14,
                padding: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                borderWidth: 1,
                borderColor: Colors.warning,
              }}
            >
              <Ionicons name="warning-outline" size={22} color={Colors.warning} />
              <Text style={{ color: Colors.warning, fontWeight: "600", fontSize: 13, flex: 1 }}>
                No API keys configured. Paper trading uses simulated data. Add keys to enable live trading.
              </Text>
            </View>
          )}

          {/* Account Info (shown when keys are connected and tested) */}
          {accountInfo && (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                padding: 16,
                gap: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Ionicons name="wallet-outline" size={18} color={Colors.accentLight} />
                <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
                  Account Info
                </Text>
              </View>
              {[
                { label: "Status", value: accountInfo.status?.replace("_", " ").toUpperCase() ?? "Unknown", color: accountInfo.status === "ACTIVE" ? Colors.success : Colors.warning },
                { label: "Buying Power", value: formatCurrency(Number(accountInfo.buying_power ?? 0)), color: colors.text },
                { label: "Portfolio Value", value: formatCurrency(Number(accountInfo.portfolio_value ?? 0)), color: colors.text },
                { label: "Cash", value: formatCurrency(Number(accountInfo.cash ?? 0)), color: colors.text },
                { label: "Equity", value: formatCurrency(Number(accountInfo.equity ?? 0)), color: colors.text },
              ].map((row) => (
                <View
                  key={row.label}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingVertical: 6,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.divider,
                  }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{row.label}</Text>
                  <Text style={{ color: row.color, fontWeight: "700", fontSize: 14 }}>{row.value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Instructions */}
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              padding: 16,
              gap: 12,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
              How to get your API keys
            </Text>
            {[
              "Sign in to your Alpaca account at alpaca.markets",
              "Go to API Keys in your dashboard",
              "Generate a new API key pair",
              "Copy and paste both values below",
            ].map((step, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: Colors.accentBg,
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 1,
                  }}
                >
                  <Text style={{ color: Colors.accentLight, fontSize: 11, fontWeight: "800" }}>{i + 1}</Text>
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 20 }}>
                  {step}
                </Text>
              </View>
            ))}
            <Pressable
              onPress={() => Linking.openURL("https://app.alpaca.markets/paper/dashboard/overview")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <Ionicons name="open-outline" size={14} color={Colors.accentLight} />
              <Text style={{ color: Colors.accentLight, fontSize: 13, fontWeight: "600" }}>
                Open Alpaca Dashboard
              </Text>
            </Pressable>
          </View>

          {/* Key ID input */}
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
              API Key ID
            </Text>
            <TextInput
              value={keyId}
              onChangeText={(v) => { setKeyId(v); setTestResult(null); }}
              placeholder={hasKeys ? existingHint ?? "Enter API Key ID..." : "Enter API Key ID..."}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                backgroundColor: colors.card,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: colors.text,
                fontSize: 15,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
            />
          </View>

          {/* Secret input */}
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
              API Secret Key
            </Text>
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 16,
              }}
            >
              <TextInput
                value={keySecret}
                onChangeText={(v) => { setKeySecret(v); setTestResult(null); }}
                placeholder={hasKeys ? "••••••••••••••••" : "Enter Secret Key..."}
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!showSecret}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  color: colors.text,
                  fontSize: 15,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                }}
              />
              <Pressable onPress={() => setShowSecret((v) => !v)} hitSlop={8}>
                <Ionicons
                  name={showSecret ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>
          </View>

          {/* Test Result */}
          {testResult && (
            <View
              style={{
                backgroundColor: testResult.ok ? Colors.successBg : Colors.dangerBg,
                borderRadius: 12,
                padding: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                borderWidth: 1,
                borderColor: testResult.ok ? Colors.success : Colors.danger,
              }}
            >
              <Ionicons
                name={testResult.ok ? "checkmark-circle" : "alert-circle"}
                size={18}
                color={testResult.ok ? Colors.success : Colors.danger}
              />
              <Text
                style={{
                  color: testResult.ok ? Colors.success : Colors.danger,
                  fontWeight: "600",
                  fontSize: 13,
                  flex: 1,
                }}
              >
                {testResult.message}
              </Text>
            </View>
          )}

          {/* Test Connection button */}
          <Pressable
            onPress={handleTestConnection}
            disabled={isTesting || !keyId.trim() || !keySecret.trim()}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingVertical: 13,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: colors.cardBorder,
              backgroundColor: colors.cardSecondary,
              opacity: isTesting || !keyId.trim() || !keySecret.trim() ? 0.5 : 1,
            }}
          >
            {isTesting ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Ionicons name="wifi-outline" size={16} color={colors.textSecondary} />
            )}
            <Text style={{ color: colors.textSecondary, fontWeight: "700", fontSize: 14 }}>
              {isTesting ? "Testing..." : "Test Connection"}
            </Text>
          </Pressable>

          {/* Security note */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 10,
              backgroundColor: colors.cardSecondary,
              borderRadius: 12,
              padding: 12,
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textTertiary} style={{ marginTop: 1 }} />
            <Text style={{ color: colors.textTertiary, fontSize: 12, lineHeight: 18, flex: 1 }}>
              Keys are stored in your private profile. They are never shared or visible to other users. Use paper trading keys for safety.
            </Text>
          </View>

          <Button
            variant="primary"
            size="lg"
            onPress={handleSave}
            loading={isSaving}
            disabled={!keyId.trim() || !keySecret.trim()}
          >
            Save API Keys
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
