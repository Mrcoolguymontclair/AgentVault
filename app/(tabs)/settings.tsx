import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  Platform,
  Share,
  Alert,
} from "react-native";
import { useDebugStore } from "@/store/debugStore";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useUserStore } from "@/store/userStore";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { useNotificationStore } from "@/store/notificationStore";
import { router } from "expo-router";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Colors } from "@/constants/colors";
import { supabase } from "@/lib/supabase";

type Plan = "free" | "pro" | "elite";

const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  elite: "Pro+",
};

const PLAN_BADGE_VARIANT: Record<Plan, "neutral" | "accent" | "warning"> = {
  free: "neutral",
  pro: "accent",
  elite: "warning",
};

export default function SettingsScreen() {
  const { colors, isDark, toggleTheme } = useTheme();
  const { user } = useUserStore();
  const { signOut, user: authUser } = useAuthStore();
  const { agents } = useAgentStore();
  const { preferences, unreadCount, updatePreferences } = useNotificationStore();
  const { devMode, setDevMode } = useDebugStore();
  const [versionTapCount, setVersionTapCount] = useState(0);
  const [showSignOutModal, setShowSignOutModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  function handleVersionTap() {
    const next = versionTapCount + 1;
    if (next >= 7) {
      const enabling = !devMode;
      setDevMode(enabling);
      setVersionTapCount(0);
      Alert.alert("Developer Mode", enabling ? "Developer Mode Enabled" : "Developer Mode Disabled");
    } else {
      setVersionTapCount(next);
    }
  }

  const plan = ((authUser?.user_metadata?.plan as Plan) ?? "free");
  const planLabel = PLAN_LABELS[plan] ?? "Free";
  const planBadgeVariant = PLAN_BADGE_VARIANT[plan] ?? "neutral";

  async function confirmSignOut() {
    setShowSignOutModal(false);
    await signOut();
  }

  async function handleExport() {
    if (!authUser?.id) return;
    setIsExporting(true);
    try {
      const { data, error } = await supabase.rpc("rpc_export_trades", {
        p_user_id: authUser.id,
      });
      setIsExporting(false);
      if (error) throw error;

      const trades = (data as any[]) ?? [];
      if (trades.length === 0) {
        Alert.alert("No Trades", "You don't have any trades to export yet.");
        return;
      }

      // Build CSV string
      const header = "id,agent_id,agent_name,symbol,side,qty,price,pnl,created_at";
      const rows = trades.map((t: any) =>
        [t.id, t.agent_id, `"${t.agent_name}"`, t.symbol, t.side, t.qty, t.price, t.pnl, t.created_at].join(",")
      );
      const csv = [header, ...rows].join("\n");

      await Share.share({
        title: "AgentVault Trade History",
        message: csv,
      });
    } catch (e: any) {
      setIsExporting(false);
      Alert.alert("Export Failed", e?.message ?? "Could not export trade history.");
    }
  }

  async function handleDeleteAccount() {
    if (!authUser?.id) return;
    setIsDeleting(true);
    try {
      await supabase.rpc("rpc_delete_account", { p_user_id: authUser.id });
      await signOut();
    } catch (e: any) {
      setIsDeleting(false);
      Alert.alert("Error", e?.message ?? "Failed to delete account. Please try again.");
    }
  }

  async function handleInvite() {
    try {
      await Share.share({
        title: "Join AgentVault",
        message:
          "I'm using AgentVault to trade with AI agents. Download it and join the leaderboard! https://agentvault.app",
      });
    } catch {}
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.8 }}>
            Settings
          </Text>
        </View>

        {/* Profile Card */}
        <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
          <View style={{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.cardBorder }}>
            {/* Purple header bar */}
            <View style={{ height: 64, backgroundColor: Colors.accent }} />
            <View
              style={{
                padding: 16,
                paddingTop: 0,
                backgroundColor: colors.card,
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
                    {authUser?.user_metadata?.avatar ?? "🚀"}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                <View style={{ gap: 4, flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 }}>
                    {authUser?.user_metadata?.display_name ?? user?.name ?? "Trader"}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                    {authUser?.email ?? user?.email}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <Badge label={`${planLabel} Plan`} variant={planBadgeVariant} size="sm" />
                    {authUser?.created_at && (
                      <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                        Since {new Date(authUser.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                      </Text>
                    )}
                  </View>
                </View>

                <Pressable
                  onPress={() => router.push("/profile-edit" as any)}
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
              <View style={{ flexDirection: "row", marginTop: 16 }}>
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
                    <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{s.value}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: "600" }}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 20 }}>
          {/* Appearance */}
          <SettingsSection title="Appearance" colors={colors}>
            <SettingsRow
              icon="moon-outline"
              iconBg="rgba(11,92,54,0.10)"
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

          {/* Subscription */}
          <SettingsSection title="Subscription" colors={colors}>
            <SettingsRow
              icon="star-outline"
              iconBg="rgba(11,92,54,0.10)"
              iconColor={Colors.accentLight}
              label={plan === "elite" ? "Pro+ Plan" : plan === "pro" ? "Pro Plan" : "Free Plan"}
              subtitle={
                plan === "elite"
                  ? "20 agents · All models · Live trading"
                  : plan === "pro"
                  ? "5 agents · Claude Haiku · Priority support"
                  : "1 agent · Groq Llama · Paper trading"
              }
              colors={colors}
              right={
                plan !== "elite" ? (
                  <Pressable
                    onPress={() => router.push("/subscription" as any)}
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
                ) : (
                  <Pressable
                    onPress={() => router.push("/subscription" as any)}
                    hitSlop={8}
                  >
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </Pressable>
                )
              }
            />
          </SettingsSection>

          {/* Notifications */}
          <SettingsSection title="Notifications" colors={colors}>
            <SettingsRow
              icon="notifications-outline"
              iconBg="rgba(11,92,54,0.10)"
              iconColor={Colors.accentLight}
              label="Notification Center"
              subtitle={unreadCount > 0 ? `${unreadCount} unread` : "View all notifications"}
              colors={colors}
              onPress={() => router.push("/notifications" as any)}
              chevron
            />
            {Platform.OS !== "web" && (
              <>
                <Divider colors={colors} />
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
                <Divider colors={colors} />
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
                <Divider colors={colors} />
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
                <Divider colors={colors} />
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

          {/* Account */}
          <SettingsSection title="Account" colors={colors}>
            <SettingsRow
              icon="share-social-outline"
              iconBg="rgba(0,214,143,0.12)"
              iconColor={Colors.success}
              label="Invite a Friend"
              subtitle="Share AgentVault with others"
              colors={colors}
              onPress={handleInvite}
              chevron
            />
            <Divider colors={colors} />
            <SettingsRow
              icon="download-outline"
              iconBg="rgba(11,92,54,0.10)"
              iconColor={Colors.accentLight}
              label={isExporting ? "Exporting..." : "Export Trade History"}
              subtitle="Download as CSV"
              colors={colors}
              onPress={plan === "free" ? () => {
                Alert.alert("Pro Feature", "Trade history export is available on Pro and Pro+ plans.", [
                  { text: "View Plans", onPress: () => router.push("/subscription" as any) },
                  { text: "Cancel", style: "cancel" },
                ]);
              } : handleExport}
              chevron
            />
            <Divider colors={colors} />
            <SettingsRow
              icon="trash-outline"
              iconBg="rgba(255,107,107,0.12)"
              iconColor={Colors.danger}
              label="Delete Account"
              subtitle="Permanently remove all data"
              colors={colors}
              onPress={() => setShowDeleteModal(true)}
              chevron
            />
          </SettingsSection>

          {/* Support */}
          <SettingsSection title="Support" colors={colors}>
            {[
              { icon: "help-circle-outline" as const, label: "Help Center", iconColor: colors.textSecondary, iconBg: colors.cardSecondary, onPress: undefined },
              { icon: "chatbubble-outline" as const, label: "Contact Support", iconColor: colors.textSecondary, iconBg: colors.cardSecondary, onPress: undefined },
              { icon: "document-text-outline" as const, label: "Terms of Service", iconColor: colors.textSecondary, iconBg: colors.cardSecondary, onPress: () => router.push("/legal/terms" as any) },
              { icon: "shield-outline" as const, label: "Privacy Policy", iconColor: colors.textSecondary, iconBg: colors.cardSecondary, onPress: () => router.push("/legal/privacy" as any) },
            ].map((item, i) => (
              <React.Fragment key={item.label}>
                {i > 0 && <Divider colors={colors} />}
                <SettingsRow
                  icon={item.icon}
                  iconBg={item.iconBg}
                  iconColor={item.iconColor}
                  label={item.label}
                  colors={colors}
                  onPress={item.onPress}
                  chevron
                />
              </React.Fragment>
            ))}
          </SettingsSection>

          {/* Developer Section (only visible in dev mode) */}
          {devMode && (
            <SettingsSection title="Developer" colors={colors}>
              <SettingsRow
                icon="construct-outline"
                iconBg={Colors.warningBg}
                iconColor={Colors.warning}
                label="Debug Console"
                subtitle="Developer tools & logs"
                colors={colors}
                onPress={() => router.push("/(tabs)/debug" as any)}
                chevron
              />
              <Divider colors={colors} />
              <SettingsRow
                icon="power-outline"
                iconBg="rgba(255,59,48,0.10)"
                iconColor={Colors.danger}
                label="Developer Mode"
                subtitle="Tap version 7x to toggle"
                colors={colors}
                right={
                  <Switch
                    value={devMode}
                    onValueChange={(v) => setDevMode(v)}
                    trackColor={{ false: colors.cardBorder, true: "rgba(255,59,48,0.25)" }}
                    thumbColor={devMode ? Colors.danger : colors.textTertiary}
                    ios_backgroundColor={colors.cardBorder}
                  />
                }
              />
            </SettingsSection>
          )}

          {/* App Info */}
          <Card>
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text style={{ color: Colors.accentLight, fontWeight: "800", fontSize: 18, letterSpacing: -0.5 }}>
                AgentVault
              </Text>
              <Pressable onPress={handleVersionTap} hitSlop={8}>
                <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                  Version 1.0.0 (Build 1) · Expo SDK 55
                </Text>
              </Pressable>
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

      {/* Sign Out Modal */}
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

      {/* Delete Account Modal */}
      <Modal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Account"
        subtitle="This action cannot be undone"
        size="md"
        primaryAction={{
          label: isDeleting ? "Deleting..." : "Delete Account",
          onPress: handleDeleteAccount,
          destructive: true,
        }}
        secondaryAction={{
          label: "Cancel",
          onPress: () => setShowDeleteModal(false),
        }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>
          All your agents, trades, and profile data will be permanently deleted. This cannot be reversed.
        </Text>
      </Modal>
    </SafeAreaView>
  );
}

function Divider({ colors }: { colors: any }) {
  return (
    <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 4 }} />
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
      {chevron && !right && (
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      )}
    </Pressable>
  );
}
