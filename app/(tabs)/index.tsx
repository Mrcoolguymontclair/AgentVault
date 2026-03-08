import React, { useState, useEffect, useRef, useCallback } from "react";
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore, type Agent } from "@/store/agentStore";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { PortfolioChart } from "@/components/ui/PortfolioChart";
import { PulsingDot } from "@/components/ui/PulsingDot";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency, formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";
import {
  fetchPortfolioSnapshots,
  getMarketStatus,
  type ChartPoint,
  type Timeframe,
} from "@/lib/services/portfolioService";

// ─── Types ─────────────────────────────────────────────────────────────────
type TradingMode = "paper" | "live";

interface DashboardCache {
  portfolioData: Partial<Record<Timeframe, ChartPoint[]>>;
  totalPnL: number;
  cachedAt: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const STATUS_DOT: Record<string, string> = {
  active: Colors.success,
  paused: Colors.warning,
  stopped: Colors.danger,
  backtesting: Colors.accentLight,
};

const TIMEFRAMES: Timeframe[] = ["1W", "1M", "3M", "ALL"];

// ─── Dashboard ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { colors, isDark } = useTheme();
  const { user: authUser } = useAuthStore();
  const { agents, recentTrades } = useAgentStore();

  const [tradingMode, setTradingMode] = useState<TradingMode>("paper");
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("1M");
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [chartWidth, setChartWidth] = useState(0);
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());

  const displayName = authUser?.user_metadata?.display_name ?? "Trader";
  const avatar = authUser?.user_metadata?.avatar ?? "🚀";

  // ─── Derived stats ────────────────────────────────────────────────────────
  const filteredAgents = agents.filter((a) => a.mode === tradingMode);
  const activeAgents = filteredAgents.filter((a) => a.status === "active");
  const totalPnL = filteredAgents.reduce((s, a) => s + a.pnl, 0);
  const totalTrades = filteredAgents.reduce((s, a) => s + a.trades, 0);
  const avgWinRate =
    filteredAgents.length > 0
      ? filteredAgents.reduce((s, a) => s + a.winRate, 0) / filteredAgents.length
      : 0;

  const todayTrades = recentTrades.filter((t) => {
    const d = new Date(t.executedAt);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  });

  const todayPnL = todayTrades.reduce((s, t) => s + t.pnl, 0);

  // ─── Cache key ────────────────────────────────────────────────────────────
  const cacheKey = `dashboard_v2_${authUser?.id}`;

  // ─── Load chart data ──────────────────────────────────────────────────────
  const loadChartData = useCallback(
    async (tf: Timeframe, fromCache = false) => {
      setChartLoading(true);

      // Try cache first (only use cached data if it has 2+ real points)
      if (fromCache) {
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          if (raw) {
            const cache: DashboardCache = JSON.parse(raw);
            const age = Date.now() - cache.cachedAt;
            const cached = cache.portfolioData[tf];
            if (age < 5 * 60 * 1000 && cached && cached.length >= 3) {
              setChartData(cached);
              setChartLoading(false);
              return;
            }
          }
        } catch {}
      }

      // Fetch from Supabase
      let data: ChartPoint[] = [];
      if (authUser?.id) {
        data = await fetchPortfolioSnapshots(authUser.id, tf);
      }

      const hasRealData = data.length >= 2;

      // Fall back to a flat line if no real snapshots — never fake wavy data
      if (!hasRealData) {
        const days =
          tf === "1W" ? 7 : tf === "1M" ? 30 : tf === "3M" ? 90 : 180;
        const now = new Date();
        const start = new Date(now);
        start.setDate(start.getDate() - days);
        const baseValue = 10000 + totalPnL;
        data = [
          { date: start.toISOString().split("T")[0], value: baseValue },
          { date: now.toISOString().split("T")[0], value: baseValue },
        ];
      }

      setChartData(data);
      setChartLoading(false);

      // Only cache real data — don't persist the flat fallback
      if (hasRealData) {
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          const cache: DashboardCache = raw
            ? JSON.parse(raw)
            : { portfolioData: {}, totalPnL, cachedAt: Date.now() };
          cache.portfolioData[tf] = data;
          cache.totalPnL = totalPnL;
          cache.cachedAt = Date.now();
          await AsyncStorage.setItem(cacheKey, JSON.stringify(cache));
        } catch {}
      }
    },
    [authUser?.id, totalPnL, cacheKey]
  );

  // ─── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadChartData(timeframe, true);
  }, [timeframe]);

  // Regenerate synthetic data when PnL changes (realtime)
  useEffect(() => {
    if (chartData.length > 0) {
      loadChartData(timeframe, false);
    }
  }, [totalPnL]);

  // Market status ticks every minute
  useEffect(() => {
    const timer = setInterval(() => setMarketStatus(getMarketStatus()), 60000);
    return () => clearInterval(timer);
  }, []);

  // ─── Refresh ─────────────────────────────────────────────────────────────
  const { loadAgents, loadRecentTrades: loadTrades } = useAgentStore();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (authUser?.id) {
      await Promise.all([
        loadAgents(authUser.id),
        loadTrades(authUser.id),
        loadChartData(timeframe, false),
      ]);
    }
    setRefreshing(false);
  }, [authUser?.id, timeframe, loadChartData, loadAgents, loadTrades]);

  // ─── Live trading confirmation ─────────────────────────────────────────
  function handleModeToggle(mode: TradingMode) {
    if (mode === "live") {
      setShowLiveModal(true);
    } else {
      setTradingMode("paper");
    }
  }

  function confirmLive() {
    setTradingMode("live");
    setShowLiveModal(false);
  }

  // ─── Market status colors ─────────────────────────────────────────────
  const mktColor =
    marketStatus.colorKey === "success"
      ? Colors.success
      : marketStatus.colorKey === "warning"
      ? Colors.warning
      : Colors.danger;

  // ─── Render ──────────────────────────────────────────────────────────────
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
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 16,
            justifyContent: "space-between",
          }}
        >
          <View>
            <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: "500" }}>
              {greeting()},
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

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {/* Market Status Badge */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: mktColor + "15",
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 100,
                borderWidth: 1,
                borderColor: mktColor + "30",
              }}
            >
              <PulsingDot color={mktColor} size={6} />
              <Text style={{ color: mktColor, fontSize: 11, fontWeight: "700" }}>
                {marketStatus.label}
              </Text>
            </View>

            <Pressable
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="notifications-outline" size={18} color={colors.textSecondary} />
            </Pressable>

            <Pressable
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
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
          {/* ── Portfolio Card ───────────────────────────────────────────── */}
          <View
            style={{
              borderRadius: 24,
              backgroundColor: isDark ? "#1A1D26" : "#FFFFFF",
              borderWidth: 1,
              borderColor: colors.cardBorder,
              overflow: "hidden",
              shadowColor: Colors.accent,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.1,
              shadowRadius: 20,
              elevation: 6,
            }}
          >
            {/* Accent top bar */}
            <View style={{ height: 3, backgroundColor: Colors.accent }} />

            <View style={{ padding: 20, paddingBottom: 12, gap: 4 }}>
              {/* Top row: label + Paper/Live toggle + eye */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: 11,
                    fontWeight: "700",
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  Portfolio Value
                </Text>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {/* Paper / Live Toggle */}
                  <View
                    style={{
                      flexDirection: "row",
                      backgroundColor: colors.cardSecondary,
                      borderRadius: 10,
                      padding: 2,
                      borderWidth: 1,
                      borderColor: colors.cardBorder,
                    }}
                  >
                    {(["paper", "live"] as TradingMode[]).map((mode) => {
                      const active = tradingMode === mode;
                      return (
                        <Pressable
                          key={mode}
                          onPress={() => handleModeToggle(mode)}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 5,
                            borderRadius: 8,
                            backgroundColor: active
                              ? mode === "live"
                                ? Colors.danger
                                : Colors.accentLight + "22"
                              : "transparent",
                          }}
                        >
                          <Text
                            style={{
                              color: active
                                ? mode === "live"
                                  ? "#FFF"
                                  : Colors.accentLight
                                : colors.textTertiary,
                              fontSize: 11,
                              fontWeight: "700",
                              textTransform: "capitalize",
                            }}
                          >
                            {mode}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Pressable onPress={() => setBalanceVisible((v) => !v)}>
                    <Ionicons
                      name={balanceVisible ? "eye-outline" : "eye-off-outline"}
                      size={16}
                      color={colors.textTertiary}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Balance */}
              <View style={{ gap: 6, marginTop: 8 }}>
                {balanceVisible ? (
                  <AnimatedNumber
                    value={10000 + totalPnL}
                    formatter={(v) => formatCurrency(v)}
                    style={{
                      color: colors.text,
                      fontSize: 42,
                      fontWeight: "800",
                      letterSpacing: -2,
                    }}
                  />
                ) : (
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 42,
                      fontWeight: "800",
                      letterSpacing: -2,
                    }}
                  >
                    ••••••
                  </Text>
                )}

                {/* All-time P&L pill */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor:
                        totalPnL >= 0 ? Colors.successBg : Colors.dangerBg,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 100,
                      gap: 4,
                    }}
                  >
                    <Ionicons
                      name={totalPnL >= 0 ? "trending-up" : "trending-down"}
                      size={13}
                      color={totalPnL >= 0 ? Colors.success : Colors.danger}
                    />
                    <AnimatedNumber
                      value={totalPnL}
                      formatter={(v) => `${v >= 0 ? "+" : ""}${formatCurrency(v)} all time`}
                      style={{
                        color: totalPnL >= 0 ? Colors.success : Colors.danger,
                        fontSize: 12,
                        fontWeight: "700",
                      }}
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* Timeframe selector */}
            <View
              style={{
                flexDirection: "row",
                paddingHorizontal: 20,
                gap: 4,
                marginBottom: 8,
              }}
            >
              {TIMEFRAMES.map((tf) => (
                <Pressable
                  key={tf}
                  onPress={() => setTimeframe(tf)}
                  style={{
                    flex: 1,
                    paddingVertical: 6,
                    borderRadius: 8,
                    backgroundColor:
                      timeframe === tf ? Colors.accent : "transparent",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor:
                      timeframe === tf ? Colors.accent : colors.cardBorder,
                  }}
                >
                  <Text
                    style={{
                      color: timeframe === tf ? "#FFF" : colors.textSecondary,
                      fontSize: 12,
                      fontWeight: "700",
                    }}
                  >
                    {tf}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Chart */}
            <View
              onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
              style={{ paddingBottom: 8 }}
            >
              {chartWidth > 0 && (
                <PortfolioChart
                  data={chartData}
                  width={chartWidth}
                  isPositive={totalPnL >= 0}
                  isDark={isDark}
                  loading={chartLoading}
                />
              )}
            </View>
          </View>

          {/* ── Quick Stats Row ──────────────────────────────────────────── */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <QuickStatCard
              label="Today's P&L"
              value={
                <AnimatedNumber
                  value={todayPnL}
                  formatter={(v) => formatCurrency(v, true)}
                  style={{
                    color: todayPnL >= 0 ? Colors.success : Colors.danger,
                    fontSize: 18,
                    fontWeight: "800",
                  }}
                />
              }
              icon="trending-up-outline"
              iconColor={todayPnL >= 0 ? Colors.success : Colors.danger}
              iconBg={
                todayPnL >= 0 ? Colors.successBg : Colors.dangerBg
              }
              colors={colors}
            />
            <QuickStatCard
              label="Trades Today"
              value={
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 18,
                    fontWeight: "800",
                  }}
                >
                  {todayTrades.length}
                </Text>
              }
              icon="flash-outline"
              iconColor={Colors.accentLight}
              iconBg={Colors.accentBg}
              colors={colors}
            />
            <QuickStatCard
              label="Win Rate"
              value={
                <Text
                  style={{
                    color: avgWinRate >= 50 ? Colors.success : Colors.warning,
                    fontSize: 18,
                    fontWeight: "800",
                  }}
                >
                  {avgWinRate > 0 ? `${avgWinRate.toFixed(1)}%` : "—"}
                </Text>
              }
              icon="trophy-outline"
              iconColor={Colors.gold}
              iconBg="rgba(255,212,59,0.12)"
              colors={colors}
            />
          </View>

          {/* ── Quick Actions ────────────────────────────────────────────── */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <QuickAction
              icon="add-circle-outline"
              label="New Agent"
              onPress={() => router.push("/(tabs)/agents")}
              accent={Colors.accent}
              accentBg={Colors.accentBg}
              colors={colors}
            />
            <QuickAction
              icon="bar-chart-outline"
              label="Leaderboard"
              onPress={() => router.push("/(tabs)/leaderboard")}
              accent={Colors.gold}
              accentBg="rgba(255,212,59,0.12)"
              colors={colors}
            />
            <QuickAction
              icon="people-outline"
              label="Social"
              onPress={() => router.push("/(tabs)/social")}
              accent={Colors.success}
              accentBg={Colors.successBg}
              colors={colors}
            />
          </View>

          {/* ── Active Agents ─────────────────────────────────────────────── */}
          <SectionHeader
            title={`${tradingMode === "live" ? "Live" : "Paper"} Agents`}
            actionLabel={filteredAgents.length > 0 ? "View All" : undefined}
            onAction={() => router.push("/(tabs)/agents")}
            colors={colors}
          />

          {filteredAgents.length === 0 ? (
            <EmptyAgentsCard tradingMode={tradingMode} colors={colors} isDark={isDark} />
          ) : (
            filteredAgents.slice(0, 3).map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                colors={colors}
                isDark={isDark}
                onPress={() => router.push("/(tabs)/agents")}
              />
            ))
          )}

          {/* ── Recent Activity ──────────────────────────────────────────── */}
          <SectionHeader title="Recent Activity" colors={colors} />

          {recentTrades.length === 0 ? (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                padding: 24,
                alignItems: "center",
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor: Colors.accentBg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="pulse-outline" size={24} color={Colors.accentLight} />
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                Trades appear here in real time as your agents execute.
              </Text>
            </View>
          ) : (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                overflow: "hidden",
              }}
            >
              {recentTrades.slice(0, 8).map((trade, i) => (
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
                        backgroundColor:
                          trade.pnl >= 0 ? Colors.successBg : Colors.dangerBg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name={
                          trade.side === "buy"
                            ? "trending-up-outline"
                            : "trending-down-outline"
                        }
                        size={17}
                        color={trade.pnl >= 0 ? Colors.success : Colors.danger}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>
                        {trade.side === "buy" ? "Bought" : "Sold"}{" "}
                        <Text style={{ fontWeight: "800" }}>{trade.symbol}</Text>
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        {trade.agentName}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 3 }}>
                      <Text
                        style={{
                          color:
                            trade.pnl >= 0 ? Colors.success : Colors.danger,
                          fontWeight: "700",
                          fontSize: 14,
                        }}
                      >
                        {trade.pnl >= 0 ? "+" : ""}
                        {formatCurrency(trade.pnl)}
                      </Text>
                      <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                        {timeAgo(trade.executedAt)}
                      </Text>
                    </View>
                  </View>
                  {i < Math.min(recentTrades.length, 8) - 1 && (
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
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Live Trading Confirmation Modal ─────────────────────────────── */}
      <Modal
        visible={showLiveModal}
        onClose={() => setShowLiveModal(false)}
        title="Switch to Live Trading?"
        subtitle="This uses real money"
        size="md"
        primaryAction={{
          label: "Yes, switch to Live",
          onPress: confirmLive,
          destructive: true,
        }}
        secondaryAction={{
          label: "Cancel",
          onPress: () => setShowLiveModal(false),
        }}
      >
        <View
          style={{
            backgroundColor: Colors.dangerBg,
            borderRadius: 14,
            padding: 16,
            gap: 10,
            borderWidth: 1,
            borderColor: Colors.danger + "30",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: Colors.danger + "20",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="warning-outline" size={22} color={Colors.danger} />
            </View>
            <Text style={{ color: Colors.danger, fontWeight: "800", fontSize: 16, flex: 1 }}>
              Live Trading Warning
            </Text>
          </View>

          {[
            "Live trading uses real money from your connected account.",
            "You may lose some or all of your invested capital.",
            "AI agents can make mistakes — always monitor your positions.",
          ].map((warning) => (
            <View key={warning} style={{ flexDirection: "row", gap: 8 }}>
              <Ionicons
                name="alert-circle-outline"
                size={14}
                color={Colors.danger}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <Text
                style={{
                  color: Colors.danger,
                  fontSize: 13,
                  lineHeight: 19,
                  flex: 1,
                }}
              >
                {warning}
              </Text>
            </View>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function QuickStatCard({
  label,
  value,
  icon,
  iconColor,
  iconBg,
  colors,
}: {
  label: string;
  value: React.ReactNode;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  colors: any;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        padding: 14,
        gap: 10,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      {value}
      <Text
        style={{
          color: colors.textTertiary,
          fontSize: 10,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginTop: -4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
  accent,
  accentBg,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  accent: string;
  accentBg: string;
  colors: any;
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
        padding: 14,
        alignItems: "center",
        gap: 8,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor: accentBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontWeight: "700",
          fontSize: 11,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AgentCard({
  agent,
  colors,
  isDark,
  onPress,
}: {
  agent: Agent;
  colors: any;
  isDark: boolean;
  onPress: () => void;
}) {
  const dotColor = STATUS_DOT[agent.status] ?? colors.textTertiary;
  const isActive = agent.status === "active";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        padding: 16,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {/* Icon */}
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            backgroundColor: Colors.accentBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="hardware-chip-outline" size={22} color={Colors.accentLight} />
        </View>

        {/* Info */}
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
            {agent.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {isActive ? (
              <PulsingDot color={dotColor} size={7} />
            ) : (
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 3.5,
                  backgroundColor: dotColor,
                }}
              />
            )}
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {agent.strategy}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>·</Text>
            <Badge
              label={agent.mode === "live" ? "Live" : "Paper"}
              variant={agent.mode === "live" ? "live" : "paper"}
              dot
              size="sm"
            />
          </View>
        </View>

        {/* P&L */}
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <AnimatedNumber
            value={agent.pnl}
            formatter={(v) => formatCurrency(v, true)}
            style={{
              color: agent.pnl >= 0 ? Colors.success : Colors.danger,
              fontWeight: "800",
              fontSize: 16,
            }}
          />
          <Text
            style={{
              color: agent.pnl >= 0 ? Colors.success : Colors.danger,
              fontSize: 12,
              fontWeight: "600",
            }}
          >
            {formatPercent(agent.pnlPct)}
          </Text>
        </View>
      </View>

      {/* Stats row */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 14,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: colors.divider,
        }}
      >
        {[
          { label: "Trades", value: `${agent.trades}` },
          {
            label: "Win Rate",
            value:
              agent.status === "backtesting" ? "—" : `${agent.winRate.toFixed(1)}%`,
          },
          {
            label: "Max DD",
            value:
              agent.status === "backtesting"
                ? "—"
                : `${agent.maxDrawdown.toFixed(1)}%`,
          },
          { label: "Sharpe", value: agent.status === "backtesting" ? "—" : `${agent.sharpeRatio.toFixed(1)}` },
        ].map((s) => (
          <View key={s.label} style={{ alignItems: "center", gap: 3 }}>
            <Text
              style={{
                color: colors.textTertiary,
                fontSize: 10,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {s.label}
            </Text>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>
              {s.value}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function EmptyAgentsCard({
  tradingMode,
  colors,
  isDark,
}: {
  tradingMode: TradingMode;
  colors: any;
  isDark: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderStyle: "dashed",
        padding: 32,
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* Illustration */}
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 24,
          backgroundColor: Colors.accentBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="hardware-chip-outline" size={40} color={Colors.accentLight} />
      </View>

      <View style={{ alignItems: "center", gap: 6 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 18,
            fontWeight: "800",
            textAlign: "center",
            letterSpacing: -0.4,
          }}
        >
          No {tradingMode === "live" ? "live" : "paper"} agents
        </Text>
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: 14,
            textAlign: "center",
            lineHeight: 20,
            maxWidth: 260,
          }}
        >
          {tradingMode === "live"
            ? "Switch an agent to live mode or deploy a new one to start trading real money."
            : "Deploy your first AI trading agent in minutes. No coding required."}
        </Text>
      </View>

      <Button
        variant="primary"
        size="md"
        icon={<Ionicons name="add" size={16} color="#fff" />}
        onPress={() => router.push("/(tabs)/agents")}
      >
        Deploy Agent
      </Button>
    </View>
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
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 4,
      }}
    >
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
      {actionLabel && onAction && (
        <Pressable onPress={onAction}>
          <Text style={{ color: Colors.accent, fontWeight: "600", fontSize: 13 }}>
            {actionLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
