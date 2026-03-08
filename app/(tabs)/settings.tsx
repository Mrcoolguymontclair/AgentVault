import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useUserStore } from "@/store/userStore";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { useNotificationStore } from "@/store/notificationStore";
import { router } from "expo-router";
import { Card, PressableCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Colors } from "@/constants/colors";

export default function SettingsScreen() {
  const { colors, isDark, toggleTheme, theme } = useTheme();
  const { user } = useUserStore();
  const { signOut, user: authUser } = useAuthStore();
  const { agents } = useAgentStore();
  const { preferences, unreadCount, updatePreferences } = useNotificationStore();
  const [showApiModal, setShowApiModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  async function confirmSignOut() {
    setShowSignOutModal(false);
    await signOut();
    // AuthRouter in _layout.tsx redirects to /auth/login when session clears
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.8 }}>
            Settings
          </Text>
        </View>

        {/* Profile Card */}
        <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
          <PressableCard style={{ borderWidth: 0, padding: 0, overflow: "hidden" }}>
            {/* Purple header bar */}
            <View
              style={{
                height: 64,
                backgroundColor: Colors.accent,
                borderTopLeftRadius: 15,
                borderTopRightRadius: 15,
              }}
            />
            <View
              style={{
                padding: 16,
                paddingTop: 0,
                backgroundColor: colors.card,
                borderBottomLeftRadius: 15,
                borderBottomRightRadius: 15,
                borderWidth: 1,
                borderTopWidth: 0,
                borderColor: colors.cardBorder,
              }}
            >
              {/* Avatar */}
              <View style={{ marginTop: -28, marginBottom: 12 }}>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 18,
                    backgroundColor: colors.cardSecondary,
                    borderWidth: 3,
                    borderColor: colors.card,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 28 }}>
                    {authUser?.user_metadata?.avatar || "🚀"}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                <View style={{ gap: 4 }}>
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 }}>
                    {authUser?.user_metadata?.display_name || user?.name}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                    {authUser?.email || user?.email}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <Badge label="Free Plan" variant="neutral" size="sm" />
                    {authUser?.created_at && (
                      <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                        Since {new Date(authUser.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                      </Text>
                    )}
                  </View>
                </View>

                <Pressable
                  style={{
                    backgroundColor: colors.cardSecondary,
                    borderRadius: 10,
                    padding: 8,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                  }}
                >
                  <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>

              {/* Stats */}
              <View style={{ flexDirection: "row", gap: 0, marginTop: 16 }}>
                {[
                  { label: "Agents", value: `${agents.length}` },
                  { label: "Active", value: `${agents.filter(a => a.status === "active").length}` },
                  { label: "Trades", value: `${agents.reduce((s, a) => s + a.trades, 0)}` },
                ].map((s, i) => (
                  <View
                    key={s.label}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      borderRightWidth: i < 2 ? 1 : 0,
                      borderRightColor: colors.divider,
                      paddingVertical: 4,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>
                      {s.value}
                    </Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: "600" }}>
                      {s.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </PressableCard>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 20 }}>
          {/* Appearance */}
          <SettingsSection title="Appearance" colors={colors}>
            <SettingsRow
              icon="moon-outline"
              iconBg="rgba(108,92,231,0.12)"
              iconColor={Colors.accentLight}
              label="Dark Mode"
              colors={colors}
              right={
                <Switch
                  value={isDark}
                  onValueChange={toggleTheme}
                  trackColor={{ false: colors.cardBorder, true: Colors.accentBg }}
                  thumbColor={isDark ? Colors.accent : colors.textTertiary}
                  ios_backgroundColor={colors.cardBorder}
                />
              }
            />
          </SettingsSection>

          {/* Plan */}
          <SettingsSection title="Subscription" colors={colors}>
            <SettingsRow
              icon="star-outline"
              iconBg="rgba(108,92,231,0.12)"
              iconColor={Colors.accentLight}
              label="Pro Plan"
              subtitle="5 agents · Live trading · Priority support"
              colors={colors}
              right={
                <Pressable
                  onPress={() => setShowPlanModal(true)}
                  style={{
                    backgroundColor: Colors.accentBg,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 13 }}>
                    Upgrade
                  </Text>
                </Pressable>
              }
            />
          </SettingsSection>

          {/* Notifications */}
          <SettingsSection title="Notifications" colors={colors}>
            {/* Notification Center shortcut */}
            <SettingsRow
              icon="notifications-outline"
              iconBg="rgba(108,92,231,0.12)"
              iconColor={Colors.accentLight}
              label="Notification Center"
              subtitle={unreadCount > 0 ? `${unreadCount} unread` : "View all notifications"}
              colors={colors}
              onPress={() => router.push("/notifications")}
              chevron
            />
            {Platform.OS !== "web" && (
              <>
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 4 }} />
                <SettingsRow
                  icon="flash-outline"
                  iconBg="rgba(0,214,143,0.12)"
                  iconColor={Colors.success}
                  label="My Trade Alerts"
                  subtitle="Every time your agents execute"
                  colors={colors}
                  right={
                    <Switch
                      value={preferences.my_trades}
                      onValueChange={(v) => { if (authUser?.id) updatePreferences(authUser.id, { my_trades: v }); }}
                      trackColor={{ false: colors.cardBorder, true: Colors.successBg }}
                      thumbColor={preferences.my_trades ? Colors.success : colors.textTertiary}
                      ios_backgroundColor={colors.cardBorder}
                    />
                  }
                />
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 4 }} />
                <SettingsRow
                  icon="shield-checkmark-outline"
                  iconBg="rgba(255,107,107,0.12)"
                  iconColor={Colors.danger}
                  label="Stop Loss / Take Profit"
                  subtitle="Risk limit and target alerts"
                  colors={colors}
                  right={
                    <Switch
                      value={preferences.stop_loss}
                      onValueChange={(v) => { if (authUser?.id) updatePreferences(authUser.id, { stop_loss: v }); }}
                      trackColor={{ false: colors.cardBorder, true: Colors.dangerBg }}
                      thumbColor={preferences.stop_loss ? Colors.danger : colors.textTertiary}
                      ios_backgroundColor={colors.cardBorder}
                    />
                  }
                />
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 4 }} />
                <SettingsRow
                  icon="people-outline"
                  iconBg="rgba(0,214,143,0.12)"
                  iconColor={Colors.success}
                  label="Followed Agents"
                  subtitle="When agents you follow make trades"
                  colors={colors}
                  right={
                    <Switch
                      value={preferences.followed_agents}
                      onValueChange={(v) => { if (authUser?.id) updatePreferences(authUser.id, { followed_agents: v }); }}
                      trackColor={{ false: colors.cardBorder, true: Colors.successBg }}
                      thumbColor={preferences.followed_agents ? Colors.success : colors.textTertiary}
                      ios_backgroundColor={colors.cardBorder}
                    />
                  }
                />
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 4 }} />
                <SettingsRow
                  icon="bar-chart-outline"
                  iconBg="rgba(255,212,59,0.12)"
                  iconColor={Colors.gold}
                  label="Daily P&L Summary"
                  subtitle="Market close recap at 4:05 PM ET"
                  colors={colors}
                  right={
                    <Switch
                      value={preferences.daily_summary}
                      onValueChange={(v) => { if (authUser?.id) updatePreferences(authUser.id, { daily_summary: v }); }}
                      trackColor={{ false: colors.cardBorder, true: "rgba(255,212,59,0.25)" }}
                      thumbColor={preferences.daily_summary ? Colors.gold : colors.textTertiary}
                      ios_backgroundColor={colors.cardBorder}
                    />
                  }
                />
              </>
            )}
          </SettingsSection>

          {/* API Keys */}
          <SettingsSection title="Integrations" colors={colors}>
            <SettingsRow
              icon="key-outline"
              iconBg="rgba(255,169,77,0.12)"
              iconColor={Colors.warning}
              label="API Keys"
              subtitle="Alpaca, Groq, Supabase"
              colors={colors}
              onPress={() => setShowApiModal(true)}
              chevron
            />
          </SettingsSection>

          {/* Support */}
          <SettingsSection title="Support" colors={colors}>
            {[
              { icon: "help-circle-outline" as const, label: "Help Center", iconColor: colors.textSecondary, iconBg: colors.cardSecondary },
              { icon: "chatbubble-outline" as const, label: "Contact Support", iconColor: colors.textSecondary, iconBg: colors.cardSecondary },
              { icon: "document-text-outline" as const, label: "Terms of Service", iconColor: colors.textSecondary, iconBg: colors.cardSecondary },
              { icon: "shield-outline" as const, label: "Privacy Policy", iconColor: colors.textSecondary, iconBg: colors.cardSecondary },
            ].map((item, i) => (
              <React.Fragment key={item.label}>
                {i > 0 && <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 4 }} />}
                <SettingsRow
                  icon={item.icon}
                  iconBg={item.iconBg}
                  iconColor={item.iconColor}
                  label={item.label}
                  colors={colors}
                  chevron
                />
              </React.Fragment>
            ))}
          </SettingsSection>

          {/* App Info */}
          <Card>
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text style={{ color: Colors.accentLight, fontWeight: "800", fontSize: 18, letterSpacing: -0.5 }}>
                AgentVault
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                Version 1.0.0 (Build 1) · Expo SDK 55
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 4 }}>
                Powered by Groq + Alpaca Markets
              </Text>
            </View>
          </Card>

          {/* Sign Out */}
          <Button variant="danger" size="lg" onPress={() => setShowSignOutModal(true)}>
            Sign Out
          </Button>
        </View>
      </ScrollView>

      {/* API Keys Modal */}
      <Modal
        visible={showApiModal}
        onClose={() => setShowApiModal(false)}
        title="API Keys"
        subtitle="Connected integrations"
        size="lg"
        secondaryAction={{ label: "Close", onPress: () => setShowApiModal(false) }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
          Your API keys are securely stored and encrypted. Never share them with anyone.
        </Text>

        {[
          {
            name: "Alpaca Markets",
            icon: "📈",
            status: "connected",
            description: "Paper trading enabled · Live trading ready",
          },
          {
            name: "Groq AI",
            icon: "🤖",
            status: "connected",
            description: "LLM inference for agent decisions",
          },
          {
            name: "Supabase",
            icon: "🗄️",
            status: "connected",
            description: "Database and real-time subscriptions",
          },
        ].map((api) => (
          <View
            key={api.name}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 14,
              backgroundColor: colors.cardSecondary,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.cardBorder,
            }}
          >
            <Text style={{ fontSize: 24 }}>{api.icon}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
                {api.name}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                {api.description}
              </Text>
            </View>
            <Badge label="Connected" variant="success" dot />
          </View>
        ))}
      </Modal>

      {/* Sign Out Confirmation Modal */}
      <Modal
        visible={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        title="Sign Out"
        subtitle="You'll need to sign back in"
        size="md"
        primaryAction={{
          label: "Sign Out",
          onPress: confirmSignOut,
          destructive: true,
        }}
        secondaryAction={{
          label: "Cancel",
          onPress: () => setShowSignOutModal(false),
        }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
          Are you sure you want to sign out of AgentVault? Your agents will continue running in the background.
        </Text>
      </Modal>

      {/* Plan Modal */}
      <Modal
        visible={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        title="Upgrade Plan"
        subtitle="Unlock the full power of AgentVault"
        size="lg"
        primaryAction={{ label: "Upgrade to Elite", onPress: () => setShowPlanModal(false) }}
        secondaryAction={{ label: "Maybe Later", onPress: () => setShowPlanModal(false) }}
      >
        {[
          {
            name: "Pro",
            price: "$29/mo",
            color: Colors.accentLight,
            bg: Colors.accentBg,
            features: ["5 active agents", "Live trading", "Priority support", "Weekly reports"],
            current: true,
          },
          {
            name: "Elite",
            price: "$79/mo",
            color: Colors.gold,
            bg: "rgba(255,212,59,0.12)",
            features: ["Unlimited agents", "Live & paper trading", "24/7 support", "Custom strategies", "Early access features"],
            current: false,
          },
        ].map((plan) => (
          <View
            key={plan.name}
            style={{
              borderRadius: 16,
              padding: 16,
              backgroundColor: plan.bg,
              borderWidth: plan.current ? 1.5 : 1,
              borderColor: plan.current ? plan.color : colors.cardBorder,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{plan.name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {plan.current && <Badge label="Current" variant="accent" size="sm" />}
                <Text style={{ color: plan.color, fontWeight: "800", fontSize: 18 }}>{plan.price}</Text>
              </View>
            </View>
            {plan.features.map((f) => (
              <View key={f} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="checkmark-circle" size={16} color={plan.color} />
                <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{f}</Text>
              </View>
            ))}
          </View>
        ))}
      </Modal>
    </SafeAreaView>
  );
}

function SettingsSection({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: any;
}) {
  return (
    <View style={{ gap: 8 }}>
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
        {title}
      </Text>
      <Card style={{ gap: 0, padding: 4 }}>
        {children}
      </Card>
    </View>
  );
}

function SettingsRow({
  icon,
  iconBg,
  iconColor,
  label,
  subtitle,
  right,
  chevron,
  onPress,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  label: string;
  subtitle?: string;
  right?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  colors: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 10,
        opacity: pressed && !!onPress ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontWeight: "600", fontSize: 15 }}>{label}</Text>
        {subtitle && (
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{subtitle}</Text>
        )}
      </View>

      {right}
      {chevron && (
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      )}
    </Pressable>
  );
}
