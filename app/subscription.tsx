import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";

type Plan = "free" | "pro" | "elite";

interface Tier {
  id: Plan;
  name: string;
  price: string;
  priceNote: string;
  tagline: string;
  color: string;
  bg: string;
  border: string;
  badge?: string;
}

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    priceNote: "forever",
    tagline: "Get started with AI trading",
    color: Colors.dark.textSecondary,
    bg: "transparent",
    border: Colors.dark.cardBorder,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$9.99",
    priceNote: "per month",
    tagline: "For serious traders",
    color: Colors.accentLight,
    bg: Colors.accentBg,
    border: Colors.accent,
    badge: "Most Popular",
  },
  {
    id: "elite",
    name: "Pro+",
    price: "$24.99",
    priceNote: "per month",
    tagline: "Unlimited power",
    color: Colors.gold,
    bg: "rgba(255,212,59,0.10)",
    border: Colors.gold,
    badge: "Best Value",
  },
];

interface Feature {
  label: string;
  free: string | boolean;
  pro: string | boolean;
  elite: string | boolean;
  icon: keyof typeof Ionicons.glyphMap;
}

const FEATURES: Feature[] = [
  {
    label: "Active Agents",
    free: "1",
    pro: "5",
    elite: "20",
    icon: "hardware-chip-outline",
  },
  {
    label: "AI Models",
    free: "Groq Llama",
    pro: "Groq + Claude Haiku",
    elite: "All Models",
    icon: "sparkles-outline",
  },
  {
    label: "Trading Mode",
    free: "Paper only",
    pro: "Paper only",
    elite: "Paper + Live",
    icon: "flash-outline",
  },
  {
    label: "Private Agents",
    free: false,
    pro: true,
    elite: true,
    icon: "eye-off-outline",
  },
  {
    label: "Notification Alerts",
    free: true,
    pro: true,
    elite: true,
    icon: "notifications-outline",
  },
  {
    label: "Trade History Export",
    free: false,
    pro: true,
    elite: true,
    icon: "download-outline",
  },
  {
    label: "Priority Support",
    free: false,
    pro: true,
    elite: true,
    icon: "headset-outline",
  },
  {
    label: "Early Access Features",
    free: false,
    pro: false,
    elite: true,
    icon: "rocket-outline",
  },
];

export default function SubscriptionScreen() {
  const { colors, isDark } = useTheme();
  const { user: authUser } = useAuthStore();
  const [upgrading, setUpgrading] = useState<Plan | null>(null);

  const currentPlan = (authUser?.user_metadata?.plan as Plan) ?? "free";

  async function handleSelectPlan(plan: Plan) {
    if (plan === currentPlan) return;
    if (plan === "free") {
      Alert.alert(
        "Downgrade to Free",
        "You'll lose access to Pro features at the end of your billing period. Continue?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Downgrade", style: "destructive", onPress: () => applyPlan(plan) },
        ]
      );
      return;
    }
    applyPlan(plan);
  }

  async function applyPlan(plan: Plan) {
    if (!authUser?.id) return;
    setUpgrading(plan);
    try {
      const { error } = await supabase.rpc("rpc_upgrade_plan", {
        p_user_id: authUser.id,
        p_plan: plan,
      });
      if (error) throw error;

      // Update auth metadata so the rest of the app reflects new plan immediately
      await supabase.auth.updateUser({ data: { plan } });

      setUpgrading(null);
      const tierName = TIERS.find((t) => t.id === plan)?.name ?? plan;
      Alert.alert(
        "Plan Updated",
        `You're now on the ${tierName} plan. Enjoy your new capabilities!`,
        [{ text: "Awesome!", onPress: () => router.back() }]
      );
    } catch (e: any) {
      setUpgrading(null);
      Alert.alert("Error", e?.message ?? "Failed to update plan. Please try again.");
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
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
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 }}>
            Plans & Pricing
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 1 }}>
            Currently on {TIERS.find((t) => t.id === currentPlan)?.name ?? "Free"}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 40 }}>
        {/* Hero */}
        <View style={{ alignItems: "center", paddingVertical: 8, gap: 6 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 18,
              backgroundColor: Colors.accentBg,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 4,
            }}
          >
            <Ionicons name="star" size={28} color={Colors.accentLight} />
          </View>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.5 }}>
            Unlock Your Edge
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 280 }}>
            More agents, smarter AI, and live trading — all in one subscription.
          </Text>
        </View>

        {/* Plan Cards */}
        {TIERS.map((tier) => {
          const isCurrent = tier.id === currentPlan;
          const isLoading = upgrading === tier.id;
          const tierColors = {
            bg: isDark ? tier.bg : tier.bg,
            border: isCurrent ? tier.color : colors.cardBorder,
          };

          return (
            <Pressable
              key={tier.id}
              onPress={() => handleSelectPlan(tier.id)}
              disabled={isCurrent || upgrading !== null}
              style={({ pressed }) => ({
                borderRadius: 20,
                borderWidth: isCurrent ? 2 : 1.5,
                borderColor: tierColors.border,
                backgroundColor: isCurrent ? tier.bg : (pressed ? colors.cardSecondary : colors.card),
                overflow: "hidden",
                opacity: (upgrading !== null && !isLoading) ? 0.5 : 1,
              })}
            >
              {/* Badge ribbon */}
              {tier.badge && (
                <View
                  style={{
                    backgroundColor: tier.color,
                    paddingHorizontal: 12,
                    paddingVertical: 4,
                    alignSelf: "flex-start",
                    borderBottomRightRadius: 10,
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.5 }}>
                    {tier.badge}
                  </Text>
                </View>
              )}

              <View style={{ padding: 18, gap: 12 }}>
                {/* Plan header */}
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <View style={{ gap: 4 }}>
                    <Text style={{ color: tier.color, fontSize: 20, fontWeight: "800" }}>{tier.name}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{tier.tagline}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -1 }}>
                      {tier.price}
                    </Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{tier.priceNote}</Text>
                  </View>
                </View>

                {/* Features for this tier */}
                <View style={{ gap: 8 }}>
                  {FEATURES.filter((f) => f[tier.id] !== false).map((f) => {
                    const value = f[tier.id];
                    return (
                      <View key={f.label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 8,
                            backgroundColor: `${tier.color}20`,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name={f.icon} size={13} color={tier.color} />
                        </View>
                        <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: "600" }}>
                            {typeof value === "string" ? value : f.label}
                          </Text>
                          {typeof value === "boolean" && value && ` — ${f.label}`}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* CTA */}
                <View
                  style={{
                    backgroundColor: isCurrent ? `${tier.color}20` : tier.color === Colors.dark.textSecondary ? colors.cardBorder : tier.color,
                    borderRadius: 12,
                    paddingVertical: 12,
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={isCurrent ? tier.color : "#fff"} />
                  ) : (
                    <>
                      <Ionicons
                        name={isCurrent ? "checkmark-circle" : "arrow-up-circle-outline"}
                        size={18}
                        color={isCurrent ? tier.color : "#fff"}
                      />
                      <Text
                        style={{
                          color: isCurrent ? tier.color : "#fff",
                          fontWeight: "800",
                          fontSize: 15,
                        }}
                      >
                        {isCurrent ? "Current Plan" : tier.id === "free" ? "Downgrade" : `Upgrade to ${tier.name}`}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </Pressable>
          );
        })}

        {/* Feature comparison table */}
        <View style={{ gap: 12 }}>
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 11,
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: 1,
              paddingLeft: 4,
            }}
          >
            Full Comparison
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                backgroundColor: colors.cardSecondary,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.cardBorder,
              }}
            >
              <Text style={{ flex: 2, color: colors.textTertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                Feature
              </Text>
              {TIERS.map((t) => (
                <Text
                  key={t.id}
                  style={{
                    flex: 1,
                    color: t.color,
                    fontSize: 11,
                    fontWeight: "800",
                    textAlign: "center",
                    textTransform: "uppercase",
                  }}
                >
                  {t.name}
                </Text>
              ))}
            </View>

            {FEATURES.map((f, i) => (
              <View
                key={f.label}
                style={{
                  flexDirection: "row",
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderBottomWidth: i < FEATURES.length - 1 ? 1 : 0,
                  borderBottomColor: colors.divider,
                  alignItems: "center",
                }}
              >
                <Text style={{ flex: 2, color: colors.textSecondary, fontSize: 13 }}>{f.label}</Text>
                {(["free", "pro", "elite"] as Plan[]).map((p) => {
                  const val = f[p];
                  return (
                    <View key={p} style={{ flex: 1, alignItems: "center" }}>
                      {typeof val === "boolean" ? (
                        <Ionicons
                          name={val ? "checkmark-circle" : "close-circle"}
                          size={18}
                          color={val ? Colors.success : colors.textTertiary}
                        />
                      ) : (
                        <Text style={{ color: colors.text, fontSize: 12, fontWeight: "600", textAlign: "center" }}>
                          {val}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        {/* Fine print */}
        <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: "center", lineHeight: 18, paddingHorizontal: 8 }}>
          MVP pricing — no credit card required. Plans take effect immediately.
          Live trading requires Alpaca API keys configured in Settings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
