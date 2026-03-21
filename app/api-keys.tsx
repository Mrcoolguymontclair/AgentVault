import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { supabase } from "@/lib/supabase";
import { Colors } from "@/constants/colors";
import { Button } from "@/components/ui/Button";

// ─── Types ───────────────────────────────────────────────────────────────────
type Provider = "groq" | "openai" | "anthropic";

interface ApiKeyRow {
  id: string;
  provider: Provider;
  label: string;
  api_key_masked: string;
  model_id: string | null;
  priority: number;
  is_active: boolean;
  total_tokens_used: number;
  total_requests: number;
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

// ─── Provider config ─────────────────────────────────────────────────────────
const PROVIDERS: Record<Provider, { label: string; icon: string; color: string; bg: string }> = {
  groq:      { label: "Groq",      icon: "⚡", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  openai:    { label: "OpenAI",    icon: "🤖", color: "#10A37F", bg: "rgba(16,163,127,0.12)" },
  anthropic: { label: "Anthropic", icon: "🧠", color: "#CC785C", bg: "rgba(204,120,92,0.12)" },
};

type ModelOption = { id: string; label: string; hint: string };

const PROVIDER_MODELS: Record<Provider, ModelOption[]> = {
  groq: [
    { id: "llama-3.1-8b-instant",    label: "Llama 3.1 8B",    hint: "Fast · Free tier" },
    { id: "llama-3.1-70b-versatile", label: "Llama 3.1 70B",   hint: "Smarter · Better reasoning" },
    { id: "mixtral-8x7b-32768",      label: "Mixtral 8x7B",    hint: "Balanced · Long context" },
  ],
  openai: [
    { id: "gpt-4o",       label: "GPT-4o",       hint: "Best · Most capable" },
    { id: "gpt-4o-mini",  label: "GPT-4o Mini",  hint: "Fast · Cost-efficient" },
    { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", hint: "Cheapest · Good for simple tasks" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", hint: "Best · Highest quality" },
    { id: "claude-haiku-4-20250414",  label: "Claude Haiku 4",  hint: "Fast · Cost-efficient" },
  ],
};

// ─── Test key endpoints ───────────────────────────────────────────────────────
async function testApiKey(provider: Provider, apiKey: string, modelId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (provider === "groq" || provider === "openai") {
      const url = provider === "groq"
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "Reply with: ok" }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `${res.status}: ${body.slice(0, 100)}` };
      }
      return { ok: true };
    } else {
      // Anthropic
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "Reply with: ok" }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `${res.status}: ${body.slice(0, 100)}` };
      }
      return { ok: true };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Network error" };
  }
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function ApiKeysScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { user: authUser } = useAuthStore();

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [todayTokens, setTodayTokens] = useState(0);
  const [todayRequests, setTodayRequests] = useState(0);

  const loadKeys = useCallback(async () => {
    if (!authUser?.id) return;
    setLoading(true);
    const { data } = await supabase.rpc("rpc_get_user_api_keys", { p_user_id: authUser.id });
    setKeys((data as ApiKeyRow[] | null) ?? []);
    // Today's usage across all keys
    const today = new Date().toISOString().split("T")[0];
    const { data: usageData } = await supabase
      .from("user_api_keys")
      .select("total_tokens_used, total_requests, last_used_at")
      .eq("user_id", authUser.id);
    // Just show total (we can't easily filter by date without a daily table — show all-time for now)
    const totalTokens = (usageData ?? []).reduce((s: number, r: any) => s + Number(r.total_tokens_used ?? 0), 0);
    const totalReqs = (usageData ?? []).reduce((s: number, r: any) => s + Number(r.total_requests ?? 0), 0);
    setTodayTokens(totalTokens);
    setTodayRequests(totalReqs);
    setLoading(false);
  }, [authUser?.id]);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  async function handleToggle(keyId: string, current: boolean) {
    await supabase.rpc("rpc_toggle_api_key", { p_key_id: keyId, p_is_active: !current });
    setKeys((prev) => prev.map((k) => k.id === keyId ? { ...k, is_active: !current } : k));
  }

  async function handleDelete(keyId: string, label: string) {
    Alert.alert("Delete Key", `Remove "${label}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          await supabase.rpc("rpc_delete_api_key", { p_key_id: keyId });
          setKeys((prev) => prev.filter((k) => k.id !== keyId));
        },
      },
    ]);
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;
    const newKeys = [...keys];
    [newKeys[index - 1], newKeys[index]] = [newKeys[index], newKeys[index - 1]];
    setKeys(newKeys);
    await supabase.rpc("rpc_reorder_keys", {
      p_user_id: authUser?.id,
      p_key_ids: newKeys.map((k) => k.id),
    });
  }

  async function handleMoveDown(index: number) {
    if (index >= keys.length - 1) return;
    const newKeys = [...keys];
    [newKeys[index], newKeys[index + 1]] = [newKeys[index + 1], newKeys[index]];
    setKeys(newKeys);
    await supabase.rpc("rpc_reorder_keys", {
      p_user_id: authUser?.id,
      p_key_ids: newKeys.map((k) => k.id),
    });
  }

  function handleAdded(newKey: ApiKeyRow) {
    setKeys((prev) => [...prev, newKey]);
    setShowAddModal(false);
  }

  const activeKey = keys.find((k) => k.is_active);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 12 }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 }}>AI API Keys</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Add your own keys for unlimited AI trading</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 16, paddingBottom: 40 }}>

        {/* Usage Summary */}
        <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, padding: 16, gap: 12 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 }}>Usage Summary</Text>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 }}>{todayTokens.toLocaleString()}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Total tokens used</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 }}>{todayRequests.toLocaleString()}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Total requests</Text>
            </View>
          </View>
          {activeKey ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.successBg, borderRadius: 10, padding: 10 }}>
              <Text style={{ fontSize: 14 }}>{PROVIDERS[activeKey.provider]?.icon ?? "🔑"}</Text>
              <Text style={{ color: Colors.success, fontWeight: "600", fontSize: 13, flex: 1 }}>
                {activeKey.label} ({PROVIDERS[activeKey.provider]?.label})
              </Text>
              <View style={{ backgroundColor: Colors.success + "22", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: Colors.success, fontSize: 11, fontWeight: "700" }}>ACTIVE</Text>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.accentBg, borderRadius: 10, padding: 10 }}>
              <Ionicons name="lock-closed-outline" size={14} color={Colors.accentLight} />
              <Text style={{ color: Colors.accentLight, fontSize: 13, flex: 1 }}>Using app default (free tier)</Text>
            </View>
          )}
        </View>

        {/* Key List */}
        {loading ? (
          <View style={{ padding: 32, alignItems: "center" }}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : keys.length === 0 ? (
          <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, borderStyle: "dashed", padding: 32, alignItems: "center", gap: 12 }}>
            <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.accentBg, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="key-outline" size={28} color={Colors.accentLight} />
            </View>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "700", textAlign: "center" }}>No custom keys yet</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 19 }}>
              Add your own Groq, OpenAI, or Anthropic key to unlock unlimited AI agent runs.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {keys.map((key, index) => {
              const p = PROVIDERS[key.provider];
              return (
                <View
                  key={key.id}
                  style={{
                    backgroundColor: colors.card, borderRadius: 16, borderWidth: 1,
                    borderColor: key.is_active ? Colors.success + "40" : colors.cardBorder,
                    padding: 14, gap: 10,
                    opacity: key.is_active ? 1 : 0.65,
                  }}
                >
                  {/* Top row */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: p?.bg ?? colors.cardSecondary, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 18 }}>{p?.icon ?? "🔑"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>{key.label}</Text>
                        <View style={{ backgroundColor: p?.bg ?? colors.cardSecondary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ color: p?.color ?? colors.textSecondary, fontSize: 10, fontWeight: "700" }}>{p?.label ?? key.provider}</Text>
                        </View>
                        {key.is_active && index === 0 && (
                          <View style={{ backgroundColor: Colors.successBg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: Colors.success, fontSize: 10, fontWeight: "700" }}>FIRST</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 1 }}>
                        {key.api_key_masked} · {key.model_id ?? "default model"}
                      </Text>
                    </View>
                    <Switch
                      value={key.is_active}
                      onValueChange={() => handleToggle(key.id, key.is_active)}
                      trackColor={{ false: colors.cardBorder, true: Colors.accentBg }}
                      thumbColor={key.is_active ? Colors.accent : colors.textTertiary}
                      ios_backgroundColor={colors.cardBorder}
                    />
                  </View>

                  {/* Stats */}
                  <View style={{ flexDirection: "row", gap: 16 }}>
                    <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                      {key.total_tokens_used.toLocaleString()} tokens · {key.total_requests} requests
                    </Text>
                    {key.last_used_at && (
                      <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                        Last: {new Date(key.last_used_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </Text>
                    )}
                  </View>

                  {/* Error badge */}
                  {key.last_error && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.dangerBg, borderRadius: 8, padding: 8 }}>
                      <Ionicons name="alert-circle-outline" size={13} color={Colors.danger} />
                      <Text style={{ color: Colors.danger, fontSize: 12, flex: 1 }} numberOfLines={1}>{key.last_error}</Text>
                    </View>
                  )}

                  {/* Actions */}
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <Text style={{ color: colors.textTertiary, fontSize: 12, flex: 1 }}>Priority #{index + 1}</Text>
                    <Pressable
                      onPress={() => handleMoveUp(index)}
                      disabled={index === 0}
                      style={{ padding: 7, borderRadius: 8, backgroundColor: colors.cardSecondary, opacity: index === 0 ? 0.3 : 1 }}
                    >
                      <Ionicons name="chevron-up" size={14} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleMoveDown(index)}
                      disabled={index >= keys.length - 1}
                      style={{ padding: 7, borderRadius: 8, backgroundColor: colors.cardSecondary, opacity: index >= keys.length - 1 ? 0.3 : 1 }}
                    >
                      <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(key.id, key.label)}
                      style={{ padding: 7, borderRadius: 8, backgroundColor: Colors.dangerBg }}
                    >
                      <Ionicons name="trash-outline" size={14} color={Colors.danger} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Fallback Section */}
        <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, padding: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: "rgba(245,158,11,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="lock-closed" size={16} color="#F59E0B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>App Default — Groq Llama 3.1</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Free fallback · used when all your keys are exhausted</Text>
            </View>
            <View style={{ backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: "#F59E0B", fontSize: 10, fontWeight: "700" }}>FALLBACK</Text>
            </View>
          </View>
        </View>

        {/* Add Key Button */}
        <Button
          variant="primary"
          size="lg"
          icon={<Ionicons name="add" size={18} color="#fff" />}
          onPress={() => setShowAddModal(true)}
        >
          Add API Key
        </Button>
      </ScrollView>

      {/* Add Key Modal */}
      {showAddModal && (
        <AddKeyModal
          colors={colors}
          isDark={isDark}
          userId={authUser?.id ?? ""}
          existingCount={keys.length}
          onClose={() => setShowAddModal(false)}
          onAdded={handleAdded}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Add Key Modal ────────────────────────────────────────────────────────────
function AddKeyModal({
  colors,
  isDark,
  userId,
  existingCount,
  onClose,
  onAdded,
}: {
  colors: any;
  isDark: boolean;
  userId: string;
  existingCount: number;
  onClose: () => void;
  onAdded: (key: ApiKeyRow) => void;
}) {
  const [step, setStep] = useState<"provider" | "model" | "details">("provider");
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelOption | null>(null);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleTestKey() {
    if (!selectedProvider || !selectedModel || !apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    const result = await testApiKey(selectedProvider, apiKey.trim(), selectedModel.id);
    setTestResult({ ok: result.ok, message: result.ok ? "Key is valid and working!" : (result.error ?? "Invalid key") });
    setTesting(false);
  }

  async function handleSave() {
    if (!selectedProvider || !selectedModel || !label.trim() || !apiKey.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("rpc_add_api_key", {
      p_user_id: userId,
      p_provider: selectedProvider,
      p_label: label.trim(),
      p_api_key: apiKey.trim(),
      p_model_id: selectedModel.id,
      p_priority: existingCount,
    });
    setSaving(false);
    if (error) {
      Alert.alert("Error", "Failed to save key: " + error.message);
      return;
    }
    const newRow: ApiKeyRow = {
      id: data as string,
      provider: selectedProvider,
      label: label.trim(),
      api_key_masked: apiKey.trim().slice(0, 8) + "...",
      model_id: selectedModel.id,
      priority: existingCount,
      is_active: true,
      total_tokens_used: 0,
      total_requests: 0,
      last_used_at: null,
      last_error: null,
      created_at: new Date().toISOString(),
    };
    onAdded(newRow);
  }

  const modalBg = isDark ? "#1A1D26" : "#FFFFFF";

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ backgroundColor: modalBg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, gap: 20, maxHeight: "90%" }}>
          {/* Modal header */}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {step !== "provider" && (
              <Pressable
                onPress={() => setStep(step === "details" ? "model" : "provider")}
                style={{ marginRight: 12 }}
              >
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </Pressable>
            )}
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", flex: 1 }}>
              {step === "provider" ? "Choose Provider" : step === "model" ? "Select Model" : "Key Details"}
            </Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Step 1: Provider */}
          {step === "provider" && (
            <View style={{ gap: 10 }}>
              {(Object.entries(PROVIDERS) as [Provider, typeof PROVIDERS[Provider]][]).map(([id, p]) => (
                <Pressable
                  key={id}
                  onPress={() => { setSelectedProvider(id); setStep("model"); }}
                  style={({ pressed }) => ({
                    flexDirection: "row", alignItems: "center", gap: 14,
                    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1,
                    borderColor: colors.cardBorder, padding: 16,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.bg, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 22 }}>{p.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}>{p.label}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                      {id === "groq" ? "Free tier available · Ultra fast" : id === "openai" ? "Industry standard · Highly capable" : "Safety-focused · Best reasoning"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          )}

          {/* Step 2: Model */}
          {step === "model" && selectedProvider && (
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
              <View style={{ gap: 10 }}>
                {PROVIDER_MODELS[selectedProvider].map((model) => (
                  <Pressable
                    key={model.id}
                    onPress={() => { setSelectedModel(model); setStep("details"); }}
                    style={({ pressed }) => ({
                      backgroundColor: colors.card, borderRadius: 14, borderWidth: 1,
                      borderColor: selectedModel?.id === model.id ? Colors.accent : colors.cardBorder,
                      padding: 14, gap: 2, opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{model.label}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 13 }}>{model.hint}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>{model.id}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}

          {/* Step 3: Details */}
          {step === "details" && selectedProvider && selectedModel && (
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              <View style={{ gap: 16 }}>
                {/* Selected summary */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 12 }}>
                  <Text style={{ fontSize: 20 }}>{PROVIDERS[selectedProvider].icon}</Text>
                  <View>
                    <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>{PROVIDERS[selectedProvider].label}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{selectedModel.label}</Text>
                  </View>
                </View>

                {/* Label */}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: "600" }}>Label</Text>
                  <TextInput
                    value={label}
                    onChangeText={setLabel}
                    placeholder={`My ${PROVIDERS[selectedProvider].label} Key`}
                    placeholderTextColor={colors.textTertiary}
                    style={{
                      backgroundColor: colors.card, borderRadius: 12, borderWidth: 1,
                      borderColor: colors.cardBorder, padding: 14,
                      color: colors.text, fontSize: 15,
                    }}
                  />
                </View>

                {/* API Key */}
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: "600" }}>API Key</Text>
                  <TextInput
                    value={apiKey}
                    onChangeText={(v) => { setApiKey(v); setTestResult(null); }}
                    placeholder="Paste your API key here"
                    placeholderTextColor={colors.textTertiary}
                    secureTextEntry
                    autoCorrect={false}
                    autoCapitalize="none"
                    style={{
                      backgroundColor: colors.card, borderRadius: 12, borderWidth: 1,
                      borderColor: colors.cardBorder, padding: 14,
                      color: colors.text, fontSize: 14, fontFamily: "monospace",
                    }}
                  />
                </View>

                {/* Test Result */}
                {testResult && (
                  <View style={{
                    flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 12,
                    backgroundColor: testResult.ok ? Colors.successBg : Colors.dangerBg,
                  }}>
                    <Ionicons
                      name={testResult.ok ? "checkmark-circle" : "alert-circle"}
                      size={16}
                      color={testResult.ok ? Colors.success : Colors.danger}
                    />
                    <Text style={{ color: testResult.ok ? Colors.success : Colors.danger, fontSize: 13, flex: 1 }}>
                      {testResult.message}
                    </Text>
                  </View>
                )}

                {/* Actions */}
                <View style={{ gap: 10 }}>
                  <Pressable
                    onPress={handleTestKey}
                    disabled={testing || !apiKey.trim()}
                    style={({ pressed }) => ({
                      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                      paddingVertical: 13, borderRadius: 12, borderWidth: 1,
                      borderColor: colors.cardBorder, backgroundColor: colors.card,
                      opacity: (testing || !apiKey.trim()) ? 0.5 : pressed ? 0.7 : 1,
                    })}
                  >
                    {testing
                      ? <ActivityIndicator size="small" color={Colors.accent} />
                      : <Ionicons name="flash-outline" size={16} color={Colors.accentLight} />
                    }
                    <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 15 }}>
                      {testing ? "Testing…" : "Test Key"}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={handleSave}
                    disabled={saving || !label.trim() || !apiKey.trim()}
                    style={({ pressed }) => ({
                      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                      paddingVertical: 14, borderRadius: 12,
                      backgroundColor: Colors.accent,
                      opacity: (saving || !label.trim() || !apiKey.trim()) ? 0.5 : pressed ? 0.8 : 1,
                    })}
                  >
                    {saving
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="checkmark" size={18} color="#fff" />
                    }
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>
                      {saving ? "Saving…" : "Save Key"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
