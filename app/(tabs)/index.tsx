import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { Card, PressableCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency, formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function HomeScreen() {
  const { colors, isDark } = useTheme();
  const { user: authUser } = useAuthStore();
  const { agents, recentTrades, loadAgents, loadRecentTrades } = useAgentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);

  const displayName = authUser?.user_metadata?.display_name ?? "Trader";
  const avatar = authUser?.user_metadata?.avatar ?? "🚀";
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const activeAgents = agents.filter((a) => a.status === "active");
  const totalPnL = agents.reduce((acc, a) => acc + a.pnl, 0);
  const totalTrades = agents.reduce((a, b) => a + b.trades, 0);

  async function onRefresh() {
    setRefreshing(true);
    if (authUser?.id) {
      await Promise.all([
        loadAgents(authUser.id),
        loadRecentTrades(authUser.id),
      ]);
    }
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 20,
          }}
        >
          <View>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: "500" }}>
              {greeting},
            </Text>
            <Text
              style={{
                color: colors.text,
                fontSize: 22,
                fontWeight: "800",
                letterSpacing: -0.5,
              }}
            >
              {displayName.split(" ")[0]} 👋
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: Colors.accentBg,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 18 }}>{avatar}</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {/* Portfolio Card */}
          <View
            style={{
              borderRadius: 24,
              overflow: "hidden",
              backgroundColor: isDark ? "#1A1D26" : "#FFFFFF",
              borderWidth: 1,
              borderColor: colors.cardBorder,
              padding: 20,
              gap: 16,
              shadowColor: Colors.accent,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.08,
              shadowRadius: 16,
              elevation: 4,
            }}
          >
            {/* Accent bar */}
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                backgroundColor: Colors.accent,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
              }}
            />

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" }}>
                Portfolio Value
              </Text>
              <Pressable onPress={() => setBalanceVisible(!balanceVisible)}>
                <Ionicons
                  name={balanceVisible ? "eye-outline" : "eye-off-outline"}
                  size={18}
                  color={colors.textTertiary}
                />
              </Pressable>
            </View>

            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 40,
                  fontWeight: "800",
                  letterSpacing: -1.5,
                }}
              >
                {balanceVisible ? formatCurrency(10000 + totalPnL) : "••••••"}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: totalPnL >= 0 ? Colors.successBg : Colors.dangerBg,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 100,
                    gap: 4,
                  }}
                >
                  <Ionicons
                    name={totalPnL >= 0 ? "trending-up" : "trending-down"}
                    size={14}
                    color={totalPnL >= 0 ? Colors.success : Colors.danger}
                  />
                  <Text style={{ color: totalPnL >= 0 ? Colors.success : Colors.danger, fontWeight: "700", fontSize: 13 }}>
                    {formatCurrency(totalPnL, true)} all time
                  </Text>
                </View>
              </View>
            </View>

            {/* Stats Row */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <StatPill
                label="Today's P&L"
                value={formatCurrency(totalPnL, true)}
                positive={totalPnL >= 0}
                colors={colors}
              />
              <StatPill
                label="Active Agents"
                value={`${activeAgents.length}`}
                positive
                colors={colors}
              />
              <StatPill
                label="Total Trades"
                value={`${totalTrades}`}
                neutral
                colors={colors}
              />
            </View>
          </View>

          {/* Quick Stats Row */}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <QuickStat
              icon="hardware-chip-outline"
              label="Active Agents"
              value={`${activeAgents.length}`}
              sublabel="Running"
              accent={Colors.accentLight}
              accentBg={Colors.accentBg}
              colors={colors}
            />
            <QuickStat
              icon="flash-outline"
              label="Total Trades"
              value={`${totalTrades}`}
              sublabel="All time"
              accent={Colors.success}
              accentBg={Colors.successBg}
              colors={colors}
            />
          </View>

          {/* Quick Actions */}
          <View style={{ gap: 12 }}>
            <SectionHeader title="Quick Actions" colors={colors} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <QuickAction
                icon="add-circle-outline"
                label="New Agent"
                onPress={() => router.push("/(tabs)/agents")}
                colors={colors}
                accent={Colors.accent}
                accentBg={Colors.accentBg}
              />
              <QuickAction
                icon="bar-chart-outline"
                label="Leaderboard"
                onPress={() => router.push("/(tabs)/leaderboard")}
                colors={colors}
                accent={Colors.gold}
                accentBg="rgba(255,212,59,0.12)"
              />
              <QuickAction
                icon="people-outline"
                label="Social"
                onPress={() => router.push("/(tabs)/social")}
                colors={colors}
                accent={Colors.success}
                accentBg={Colors.successBg}
              />
            </View>
          </View>

          {/* Active Agents */}
          <View style={{ gap: 12 }}>
            <SectionHeader
              title="Active Agents"
              actionLabel="View All"
              onAction={() => router.push("/(tabs)/agents")}
              colors={colors}
            />

            {activeAgents.length === 0 ? (
              <Card>
                <View style={{ alignItems: "center", paddingVertical: 20, gap: 8 }}>
                  <Ionicons name="hardware-chip-outline" size={32} color={colors.textTertiary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
                    No active agents. Launch one to start trading.
                  </Text>
                </View>
              </Card>
            ) : (
              activeAgents.slice(0, 2).map((agent) => (
                <PressableCard key={agent.id} onPress={() => router.push("/(tabs)/agents")}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 13,
                        backgroundColor: Colors.accentBg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="hardware-chip-outline" size={22} color={Colors.accentLight} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
                        {agent.name}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        {agent.strategy} · {agent.trades} trades
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text
                        style={{
                          color: agent.pnl >= 0 ? Colors.success : Colors.danger,
                          fontWeight: "800",
                          fontSize: 16,
                        }}
                      >
                        {formatCurrency(agent.pnl, true)}
                      </Text>
                      <Badge
                        label={agent.mode}
                        variant={agent.mode === "live" ? "live" : "paper"}
                        dot
                      />
                    </View>
                  </View>
                </PressableCard>
              ))
            )}
          </View>

          {/* Recent Activity */}
          <View style={{ gap: 12 }}>
            <SectionHeader title="Recent Activity" colors={colors} />
            {recentTrades.length === 0 ? (
              <Card>
                <View style={{ alignItems: "center", paddingVertical: 20, gap: 8 }}>
                  <Ionicons name="pulse-outline" size={32} color={colors.textTertiary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
                    No trades yet. Activity will appear here in real time.
                  </Text>
                </View>
              </Card>
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {recentTrades.slice(0, 6).map((trade, i) => (
                  <View key={trade.id}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        padding: 14,
                      }}
                    >
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 11,
                          backgroundColor: trade.pnl >= 0 ? Colors.successBg : Colors.dangerBg,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name={trade.side === "buy" ? "trending-up-outline" : "trending-down-outline"}
                          size={18}
                          color={trade.pnl >= 0 ? Colors.success : Colors.danger}
                        />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>
                          {trade.side === "buy" ? "Bought" : "Sold"} {trade.symbol}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                          {trade.agentName}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 3 }}>
                        <Text
                          style={{
                            color: trade.pnl >= 0 ? Colors.success : Colors.danger,
                            fontWeight: "700",
                            fontSize: 14,
                          }}
                        >
                          {formatCurrency(trade.pnl, true)}
                        </Text>
                        <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                          {timeAgo(trade.executedAt)}
                        </Text>
                      </View>
                    </View>
                    {i < Math.min(recentTrades.length, 6) - 1 && (
                      <View
                        style={{
                          height: 1,
                          backgroundColor: colors.divider,
                          marginHorizontal: 14,
                        }}
                      />
                    )}
                  </View>
                ))}
              </Card>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatPill({
  label,
  value,
  positive,
  neutral,
  colors,
}: {
  label: string;
  value: string;
  positive?: boolean;
  neutral?: boolean;
  colors: any;
}) {
  const textColor = neutral
    ? colors.text
    : positive
    ? Colors.success
    : Colors.danger;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.cardSecondary,
        borderRadius: 12,
        padding: 12,
        gap: 4,
      }}
    >
      <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text style={{ color: textColor, fontWeight: "800", fontSize: 16 }}>{value}</Text>
    </View>
  );
}

function QuickStat({
  icon,
  label,
  value,
  sublabel,
  accent,
  accentBg,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  sublabel: string;
  accent: string;
  accentBg: string;
  colors: any;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: 16,
        padding: 16,
        gap: 10,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          backgroundColor: accentBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View>
        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 24, letterSpacing: -0.5 }}>
          {value}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
          {label} · {sublabel}
        </Text>
      </View>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  colors,
  accent,
  accentBg,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: any;
  accent: string;
  accentBg: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: 16,
        padding: 16,
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          backgroundColor: accentBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={22} color={accent} />
      </View>
      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 12, textAlign: "center" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SectionHeader({
  title,
  actionLabel,
  onAction,
  colors,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  colors: any;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text
        style={{
          color: colors.text,
          fontSize: 17,
          fontWeight: "800",
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>
      {actionLabel && (
        <Pressable onPress={onAction}>
          <Text style={{ color: Colors.accent, fontWeight: "600", fontSize: 14 }}>
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
