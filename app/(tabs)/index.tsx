import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Animated,
  Platform,
} from "react-native";
import { BellButton } from "@/components/notifications/BellButton";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useUserStore } from "@/store/userStore";
import { useAgentStore, type Agent } from "@/store/agentStore";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { PortfolioChart } from "@/components/ui/PortfolioChart";
import { Sparkline } from "@/components/ui/Sparkline";
import { PulsingDot } from "@/components/ui/PulsingDot";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency, formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";
import {
  fetchPortfolioSnapshots,
  buildChartFromTrades,
  fetchSpyBars,
  buildSpyOverlay,
  fetchAllAgentSnapshots,
  fetchCurrentPrices,
  getMarketStatus,
  AGENT_CHART_COLORS,
  type ChartPoint,
  type Timeframe,
} from "@/lib/services/portfolioService";
import { MultiLineChart } from "@/components/ui/PortfolioChart";
import {
  fetchPortfolioHoldings,
  fetchPortfolioStats,
  applyCurrentPrices,
  getCompanyName,
  type Holding,
  type PortfolioStats,
} from "@/lib/services/holdingsService";

// ─── Types ─────────────────────────────────────────────────────────────────
type TradingMode = "paper" | "live";

interface DashboardCache {
  portfolioData: Partial<Record<Timeframe, ChartPoint[]>>;
  totalPnL: number;
  cachedAt: number;
}

// ─── Allocation palette (distinct colours for pie-bar segments) ──────────────
const ALLOC_COLORS = [
  "#22C55E", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#84CC16", "#06B6D4",
];

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
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
  const { user, refreshProfile } = useUserStore();
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
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // SPY overlay
  const [showSpy, setShowSpy] = useState(false);
  const [spyBars, setSpyBars] = useState<{ date: string; close: number }[]>([]);

  // Multi-agent chart view
  const [chartView, setChartView] = useState<"total" | "agents">("total");
  const [agentSnapshots, setAgentSnapshots] = useState<Record<string, ChartPoint[]>>({});

  // Holdings + stats state
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(true);
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [livePortfolioValue, setLivePortfolioValue] = useState<number | null>(null);

  const displayName = authUser?.user_metadata?.display_name ?? "Trader";
  const avatar = authUser?.user_metadata?.avatar ?? "🚀";

  // Fade-in on mount
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, []);

  // Spin animation for the refresh button
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinDeg = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  useEffect(() => {
    if (refreshing) {
      spinAnim.setValue(0);
      Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 700, useNativeDriver: true })
      ).start();
    } else {
      spinAnim.setValue(0);
    }
  }, [refreshing]);

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

  // Total current holdings value
  const totalHoldingsValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  // Live value = 10000 + realizedPnL + unrealizedPnL (computed after fetching current prices)
  // Falls back to profile balance, then to agent-derived estimate
  const portfolioValue = livePortfolioValue ?? user?.balance ?? (10000 + totalPnL);

  // ─── Cache key ────────────────────────────────────────────────────────────
  const cacheKey = `dashboard_v2_${authUser?.id}`;

  // Ref so loadChartData always uses the latest portfolio value without stale closures
  const portfolioValueRef = useRef(portfolioValue);
  portfolioValueRef.current = portfolioValue;
  // Track when livePortfolioValue was last used to rebuild the chart
  const prevLiveValueRef = useRef<number | null>(null);

  // ─── Load chart data ──────────────────────────────────────────────────────
  const loadChartData = useCallback(
    async (tf: Timeframe, fromCache = false) => {
      setChartLoading(true);

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

      let data: ChartPoint[] = [];
      if (authUser?.id) {
        data = await fetchPortfolioSnapshots(authUser.id, tf);
      }

      const hasRealData = data.length >= 2;

      if (!hasRealData && authUser?.id) {
        const days = tf === "1W" ? 7 : tf === "1M" ? 30 : tf === "3M" ? 90 : 365;
        data = await buildChartFromTrades(authUser.id, portfolioValueRef.current, days);
      }

      setChartData(data);
      setChartLoading(false);

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

  // ─── Load holdings + stats + live prices ─────────────────────────────────
  const loadHoldingsAndStats = useCallback(async () => {
    if (!authUser?.id) return;
    setHoldingsLoading(true);
    setStatsLoading(true);

    const [h, s] = await Promise.all([
      fetchPortfolioHoldings(authUser.id),
      fetchPortfolioStats(authUser.id),
    ]);

    // Fetch live (or last-close) prices for all open positions (including shorts, which have qty < 0)
    const openSymbols = h.filter((x) => x.totalQuantity !== 0).map((x) => x.symbol);
    const prices = await fetchCurrentPrices(openSymbols);
    const updatedHoldings = applyCurrentPrices(h, prices);

    // Portfolio value = starting balance + realized P&L + unrealized P&L
    // Includes both long and short positions (shorts have negative qty, handled in applyCurrentPrices)
    const realizedPnl   = s?.totalPnl ?? 0;
    const unrealizedPnl = updatedHoldings.reduce((sum, x) => sum + x.unrealizedPnl, 0);
    setLivePortfolioValue(10000 + realizedPnl + unrealizedPnl);
    // Also update the profile balance in the background for persistence
    refreshProfile();

    setHoldings(updatedHoldings);
    setStats(s);
    setHoldingsLoading(false);
    setStatsLoading(false);
  }, [authUser?.id]);

  // ─── SPY bars ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchSpyBars(365).then(setSpyBars);
  }, []);

  // ─── Agent snapshots for multi-agent chart ────────────────────────────────
  useEffect(() => {
    if (chartView === "agents" && filteredAgents.length > 0) {
      fetchAllAgentSnapshots(filteredAgents.map((a) => a.id), timeframe).then(setAgentSnapshots);
    }
  }, [chartView, timeframe, filteredAgents.length]);

  // ─── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadChartData(timeframe, true);
  }, [timeframe]);

  useEffect(() => {
    loadHoldingsAndStats();
    refreshProfile();
  }, [authUser?.id]);

  useEffect(() => {
    if (chartData.length > 0) {
      loadChartData(timeframe, false);
    }
  }, [totalPnL]);

  // Rebuild chart once live portfolio value is computed (so trade-based chart shows real endpoint)
  useEffect(() => {
    if (
      livePortfolioValue !== null &&
      livePortfolioValue !== prevLiveValueRef.current &&
      authUser?.id
    ) {
      prevLiveValueRef.current = livePortfolioValue;
      loadChartData(timeframe, false);
    }
  }, [livePortfolioValue, timeframe, authUser?.id]);

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
        loadHoldingsAndStats(),
        refreshProfile(),
      ]);
    }
    setLastRefreshed(new Date());
    setRefreshing(false);
  }, [authUser?.id, timeframe, loadChartData, loadAgents, loadTrades, loadHoldingsAndStats, refreshProfile]);

  // Auto-refresh: 30s during market hours, 5 min outside
  useEffect(() => {
    const intervalMs = marketStatus.status === "open" ? 30_000 : 5 * 60_000;
    const timer = setInterval(() => { onRefresh(); }, intervalMs);
    return () => clearInterval(timer);
  }, [onRefresh, marketStatus.status]);

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
      <Animated.View style={{ flex: 1, opacity: Platform.OS === "web" ? 1 : fadeAnim }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
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

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
                {marketStatus.status === "open"
                  ? "Live Prices"
                  : marketStatus.status === "premarket"
                  ? "Pre-Market"
                  : marketStatus.status === "afterhours"
                  ? "After Hours"
                  : "Closing Prices"}
              </Text>
            </View>
            <Pressable
              onPress={onRefresh}
              hitSlop={8}
              style={{
                width: 34, height: 34, borderRadius: 10,
                backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
                <Ionicons
                  name="refresh-outline"
                  size={16}
                  color={refreshing ? Colors.accent : colors.textSecondary}
                />
              </Animated.View>
            </Pressable>
            <BellButton />
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
            <View style={{ height: 3, backgroundColor: Colors.accent }} />
            <View style={{ padding: 20, paddingBottom: 12, gap: 4 }}>
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
                              ? mode === "live" ? Colors.danger : Colors.accentLight + "22"
                              : "transparent",
                          }}
                        >
                          <Text
                            style={{
                              color: active
                                ? mode === "live" ? "#FFF" : Colors.accentLight
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

              <View style={{ gap: 6, marginTop: 8 }}>
                {balanceVisible ? (
                  <AnimatedNumber
                    value={portfolioValue}
                    formatter={(v) => formatCurrency(v)}
                    style={{
                      color: colors.text,
                      fontSize: 42,
                      fontWeight: "800",
                      letterSpacing: -2,
                    }}
                  />
                ) : (
                  <Text style={{ color: colors.text, fontSize: 42, fontWeight: "800", letterSpacing: -2 }}>
                    ••••••
                  </Text>
                )}

                {(() => {
                  const allTimePnl = portfolioValue - 10000;
                  const allTimePct = (allTimePnl / 10000) * 100;
                  const up = allTimePnl >= 0;
                  return (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: up ? Colors.successBg : Colors.dangerBg,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 100,
                          gap: 4,
                        }}
                      >
                        <Ionicons
                          name={up ? "trending-up" : "trending-down"}
                          size={13}
                          color={up ? Colors.success : Colors.danger}
                        />
                        <Text style={{ color: up ? Colors.success : Colors.danger, fontSize: 12, fontWeight: "700" }}>
                          {up ? "+" : ""}{formatCurrency(allTimePnl, true)} ({up ? "+" : ""}{allTimePct.toFixed(2)}%) all time
                        </Text>
                      </View>
                    </View>
                  );
                })()}
              </View>
            </View>

            {/* Timeframe selector + controls row */}
            <View style={{ paddingHorizontal: 20, marginBottom: 8, gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 4 }}>
                {TIMEFRAMES.map((tf) => (
                  <Pressable
                    key={tf}
                    onPress={() => setTimeframe(tf)}
                    style={{
                      flex: 1,
                      paddingVertical: 6,
                      borderRadius: 8,
                      backgroundColor: timeframe === tf ? Colors.accent : "transparent",
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: timeframe === tf ? Colors.accent : colors.cardBorder,
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

              {/* Chart view toggle + SPY overlay */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", backgroundColor: colors.cardSecondary, borderRadius: 8, padding: 2, gap: 2 }}>
                  {(["total", "agents"] as const).map((view) => (
                    <Pressable
                      key={view}
                      onPress={() => setChartView(view)}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
                        backgroundColor: chartView === view ? colors.card : "transparent",
                      }}
                    >
                      <Text style={{ color: chartView === view ? colors.text : colors.textTertiary, fontSize: 11, fontWeight: "700" }}>
                        {view === "total" ? "Total" : "By Agent"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  onPress={() => setShowSpy((v) => !v)}
                  style={{
                    flexDirection: "row", alignItems: "center", gap: 5,
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                    backgroundColor: showSpy ? "rgba(120,120,120,0.15)" : colors.cardSecondary,
                    borderWidth: 1, borderColor: showSpy ? "rgba(160,160,160,0.3)" : colors.cardBorder,
                  }}
                >
                  <View style={{ width: 14, height: 2, borderRadius: 1, borderStyle: "dashed", borderWidth: 1, borderColor: showSpy ? "#888" : colors.textTertiary }} />
                  <Text style={{ color: showSpy ? colors.text : colors.textTertiary, fontSize: 11, fontWeight: "700" }}>
                    vs S&P 500
                  </Text>
                </Pressable>
              </View>

              {/* Updated timestamp */}
              {lastRefreshed && (
                <Text style={{ color: colors.textTertiary, fontSize: 10, textAlign: "right" }}>
                  Updated {timeAgo(lastRefreshed.toISOString())}
                </Text>
              )}
            </View>

            <View onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)} style={{ paddingBottom: 8 }}>
              {chartWidth > 0 && (
                chartView === "agents" ? (
                  <MultiLineChart
                    lines={filteredAgents.slice(0, 8).map((a, i) => ({
                      id: a.id,
                      label: a.name,
                      data: agentSnapshots[a.id] ?? [],
                      color: AGENT_CHART_COLORS[i % AGENT_CHART_COLORS.length],
                    }))}
                    width={chartWidth}
                    isDark={isDark}
                  />
                ) : (
                  <PortfolioChart
                    data={chartData}
                    width={chartWidth}
                    isPositive={totalPnL >= 0}
                    isDark={isDark}
                    loading={chartLoading}
                    spyData={buildSpyOverlay(spyBars, chartData)}
                    showSpy={showSpy}
                  />
                )
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
              iconBg={todayPnL >= 0 ? Colors.successBg : Colors.dangerBg}
              colors={colors}
            />
            <QuickStatCard
              label="Trades Today"
              value={
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800" }}>
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

          {/* ── Holdings Section ─────────────────────────────────────────── */}
          <SectionHeader
            title="Holdings"
            subtitle={
              holdingsLoading
                ? "Loading…"
                : holdings.length > 0
                ? `${holdings.length} position${holdings.length !== 1 ? "s" : ""} · ${formatCurrency(totalHoldingsValue)}`
                : undefined
            }
            colors={colors}
          />

          {holdingsLoading ? (
            <HoldingsSkeleton colors={colors} isDark={isDark} />
          ) : holdings.length === 0 ? (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                borderStyle: "dashed",
                padding: 28,
                alignItems: "center",
                gap: 8,
              }}
            >
              <Ionicons name="pie-chart-outline" size={32} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
                No open positions yet. Holdings appear here once your agents execute trades.
              </Text>
            </View>
          ) : (
            <>
              {/* Holdings list */}
              <View
                style={{
                  backgroundColor: colors.card,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  overflow: "hidden",
                }}
              >
                {holdings.map((h, i) => (
                  <View key={h.symbol}>
                    <HoldingRow holding={h} colors={colors} isDark={isDark} />
                    {i < holdings.length - 1 && (
                      <View style={{ height: 1, backgroundColor: colors.divider, marginHorizontal: 16 }} />
                    )}
                  </View>
                ))}
              </View>

              {/* Allocation bar */}
              {holdings.length > 1 && totalHoldingsValue > 0 && (
                <AllocationBar holdings={holdings} totalValue={totalHoldingsValue} colors={colors} />
              )}
            </>
          )}

          {/* ── Performance Stats ─────────────────────────────────────────── */}
          <SectionHeader title="Performance" colors={colors} />

          {statsLoading ? (
            <StatsSkeleton colors={colors} />
          ) : stats && (stats.totalTrades > 0 || holdings.length > 0) ? (
            <StatsGrid stats={stats} holdings={holdings} colors={colors} />
          ) : (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                borderStyle: "dashed",
                padding: 24,
                alignItems: "center",
                gap: 8,
              }}
            >
              <Ionicons name="analytics-outline" size={32} color={colors.textTertiary} />
              <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
                Stats appear after your first trade.
              </Text>
            </View>
          )}

          {/* ── Quick Actions ────────────────────────────────────────────── */}
          <SectionHeader title="Quick Actions" colors={colors} />
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
                onPress={() => router.push(`/agent/${agent.id}` as any)}
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
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
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
                          color: trade.pnl >= 0 ? Colors.success : Colors.danger,
                          fontWeight: "700",
                          fontSize: 14,
                        }}
                      >
                        {trade.pnl >= 0 ? "+" : ""}{formatCurrency(trade.pnl)}
                      </Text>
                      <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                        {timeAgo(trade.executedAt)}
                      </Text>
                    </View>
                  </View>
                  {i < Math.min(recentTrades.length, 8) - 1 && (
                    <View style={{ height: 1, backgroundColor: colors.divider, marginHorizontal: 14 }} />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      </Animated.View>

      {/* ── Live Trading Confirmation Modal ─────────────────────────────── */}
      <Modal
        visible={showLiveModal}
        onClose={() => setShowLiveModal(false)}
        title="Switch to Live Trading?"
        subtitle="This uses real money"
        size="md"
        primaryAction={{ label: "Yes, switch to Live", onPress: confirmLive, destructive: true }}
        secondaryAction={{ label: "Cancel", onPress: () => setShowLiveModal(false) }}
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
                width: 40, height: 40, borderRadius: 12,
                backgroundColor: Colors.danger + "20",
                alignItems: "center", justifyContent: "center",
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
              <Ionicons name="alert-circle-outline" size={14} color={Colors.danger} style={{ marginTop: 2, flexShrink: 0 }} />
              <Text style={{ color: Colors.danger, fontSize: 13, lineHeight: 19, flex: 1 }}>{warning}</Text>
            </View>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── HoldingRow ───────────────────────────────────────────────────────────────
function HoldingRow({ holding, colors, isDark }: { holding: Holding; colors: any; isDark: boolean }) {
  const isShort  = holding.totalQuantity < 0;
  const absQty   = Math.abs(holding.totalQuantity);
  const isProfitable = holding.unrealizedPnl >= 0;
  const pnlColor = isProfitable ? Colors.success : Colors.danger;

  // For shorts, show the absolute exposure (what you'd owe to buy back)
  const displayValue = isShort
    ? Math.abs(holding.currentValue)
    : holding.currentValue;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: 14,
        gap: 12,
        borderLeftWidth: isShort ? 3 : 0,
        borderLeftColor: isShort ? Colors.danger + "80" : "transparent",
      }}
    >
      {/* Ticker icon */}
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          backgroundColor: isShort ? Colors.dangerBg : (isProfitable ? Colors.successBg : Colors.dangerBg),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text
          style={{
            color: isShort ? Colors.danger : pnlColor,
            fontWeight: "800",
            fontSize: 11,
            letterSpacing: -0.3,
          }}
        >
          {holding.symbol.slice(0, 4)}
        </Text>
      </View>

      {/* Name + detail */}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
            {holding.symbol}
          </Text>
          {isShort && (
            <View
              style={{
                backgroundColor: Colors.dangerBg,
                borderRadius: 5,
                paddingHorizontal: 6,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: Colors.danger, fontSize: 10, fontWeight: "800", letterSpacing: 0.3 }}>
                SHORT
              </Text>
            </View>
          )}
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: 11 }} numberOfLines={1}>
          {getCompanyName(holding.symbol)}
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 1 }}>
          {isShort
            ? `${absQty} shares short · shorted @ ${formatCurrency(holding.avgCost)}`
            : `${absQty.toFixed(4)} shares · avg ${formatCurrency(holding.avgCost)}`}
        </Text>
      </View>

      {/* Sparkline */}
      <Sparkline
        prices={holding.priceHistory}
        width={56}
        height={26}
        color={pnlColor}
      />

      {/* Value + P&L */}
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          {isShort && (
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>exposure</Text>
          )}
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
            {formatCurrency(displayValue)}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: isProfitable ? Colors.successBg : Colors.dangerBg,
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 6,
          }}
        >
          <Text style={{ color: pnlColor, fontSize: 11, fontWeight: "700" }}>
            {isProfitable ? "+" : ""}{formatCurrency(holding.unrealizedPnl, true)}{" "}
            ({isProfitable ? "+" : ""}{holding.unrealizedPnlPct.toFixed(2)}%)
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── AllocationBar ────────────────────────────────────────────────────────────
function AllocationBar({ holdings, totalValue, colors }: {
  holdings: Holding[];
  totalValue: number;
  colors: any;
}) {
  const top = holdings.slice(0, 8);

  return (
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
      <Text
        style={{
          color: colors.textSecondary,
          fontSize: 11,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        Allocation
      </Text>

      {/* Segmented bar */}
      <View style={{ flexDirection: "row", height: 8, borderRadius: 8, overflow: "hidden", gap: 1 }}>
        {top.map((h, i) => {
          const pct = (h.currentValue / totalValue) * 100;
          return (
            <View
              key={h.symbol}
              style={{
                flex: pct,
                backgroundColor: ALLOC_COLORS[i % ALLOC_COLORS.length],
                borderRadius: 2,
              }}
            />
          );
        })}
      </View>

      {/* Legend */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {top.map((h, i) => {
          const pct = (h.currentValue / totalValue) * 100;
          return (
            <View key={h.symbol} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: ALLOC_COLORS[i % ALLOC_COLORS.length],
                }}
              />
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 12 }}>
                {h.symbol}
              </Text>
              <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                {pct.toFixed(1)}%
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── StatsGrid ────────────────────────────────────────────────────────────────
function StatsGrid({ stats, holdings, colors }: { stats: PortfolioStats; holdings: Holding[]; colors: any }) {
  // ── Position-based fallback metrics (used when no closed trades yet) ────────
  const profitablePositions = holdings.filter((h) => h.unrealizedPnl > 0);
  const posWinRate = holdings.length > 0 ? (profitablePositions.length / holdings.length) * 100 : 0;
  const avgPosPnl =
    holdings.length > 0
      ? holdings.reduce((s, h) => s + h.unrealizedPnl, 0) / holdings.length
      : 0;
  const bestPos = holdings.reduce<Holding | null>(
    (b, h) => (b === null || h.unrealizedPnl > b.unrealizedPnl ? h : b), null
  );
  const worstPos = holdings.reduce<Holding | null>(
    (w, h) => (w === null || h.unrealizedPnl < w.unrealizedPnl ? h : w), null
  );

  // Use trade-based values when available; fall back to position data
  const usePosFallback = stats.winRate === 0 && holdings.length > 0;
  const effectiveWinRate = usePosFallback ? posWinRate : stats.winRate;
  const effectiveAvgPnl = stats.avgTradePnl !== 0 ? stats.avgTradePnl : avgPosPnl;
  const effectiveBestSymbol =
    stats.bestTradePnl > 0.01
      ? stats.bestTradeSymbol
      : bestPos && bestPos.unrealizedPnl > 0.01
      ? bestPos.symbol
      : "—";
  const effectiveBestPnl =
    stats.bestTradePnl > 0.01 ? stats.bestTradePnl : (bestPos?.unrealizedPnl ?? 0);
  const effectiveWorstSymbol =
    stats.worstTradePnl < -0.01
      ? stats.worstTradeSymbol
      : worstPos && worstPos.unrealizedPnl < -0.01
      ? worstPos.symbol
      : "—";
  const effectiveWorstPnl =
    stats.worstTradePnl < -0.01 ? stats.worstTradePnl : (worstPos?.unrealizedPnl ?? 0);

  // ── Sharpe ──────────────────────────────────────────────────────────────────
  const sharpeColor =
    stats.sharpeRatio === null ? colors.textSecondary
    : stats.sharpeRatio >= 1 ? Colors.success
    : stats.sharpeRatio >= 0 ? Colors.warning
    : Colors.danger;
  const sharpeValue = stats.sharpeRatio !== null ? stats.sharpeRatio.toFixed(2) : "N/A";

  const activeSinceStr = stats.activeSince
    ? new Date(stats.activeSince).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  const cards = [
    {
      icon: "analytics-outline",
      label: "Sharpe Ratio",
      value: sharpeValue,
      valueColor: sharpeColor,
      iconColor: sharpeColor,
      iconBg: sharpeColor + "18",
      hint: stats.sharpeRatio !== null ? "Risk-adjusted return" : "Need more trade history",
    },
    {
      icon: "trending-down-outline",
      label: "Max Drawdown",
      value: `${stats.maxDrawdownPct > 0 ? `-${stats.maxDrawdownPct.toFixed(1)}` : "0.0"}%`,
      valueColor: stats.maxDrawdownPct > 10 ? Colors.danger : stats.maxDrawdownPct > 5 ? Colors.warning : Colors.success,
      iconColor: Colors.danger,
      iconBg: Colors.dangerBg,
      hint: "Biggest peak-to-trough",
    },
    {
      icon: "trophy-outline",
      label: "Win Rate",
      value: `${effectiveWinRate.toFixed(1)}%`,
      valueColor: effectiveWinRate >= 55 ? Colors.success : effectiveWinRate >= 45 ? Colors.warning : Colors.danger,
      iconColor: Colors.gold,
      iconBg: "rgba(212,175,55,0.15)",
      hint: usePosFallback ? "Profitable positions" : "Profitable trades",
    },
    {
      icon: "cash-outline",
      label: stats.avgTradePnl !== 0 ? "Avg Trade P&L" : "Avg Position P&L",
      value: formatCurrency(effectiveAvgPnl, true),
      valueColor: effectiveAvgPnl >= 0 ? Colors.success : Colors.danger,
      iconColor: effectiveAvgPnl >= 0 ? Colors.success : Colors.danger,
      iconBg: effectiveAvgPnl >= 0 ? Colors.successBg : Colors.dangerBg,
      hint: stats.avgTradePnl !== 0 ? "Average per trade" : "Avg unrealized P&L",
    },
    {
      icon: "arrow-up-circle-outline",
      label: "Best Trade",
      value: effectiveBestSymbol !== "—"
        ? `${effectiveBestSymbol} +${formatCurrency(effectiveBestPnl, true)}`
        : "—",
      valueColor: Colors.success,
      iconColor: Colors.success,
      iconBg: Colors.successBg,
      hint: stats.bestTradePnl > 0.01 ? "Single best trade" : "Best open position",
    },
    {
      icon: "arrow-down-circle-outline",
      label: "Worst Trade",
      value: effectiveWorstSymbol !== "—"
        ? `${effectiveWorstSymbol} ${formatCurrency(effectiveWorstPnl, true)}`
        : "—",
      valueColor: Colors.danger,
      iconColor: Colors.danger,
      iconBg: Colors.dangerBg,
      hint: stats.worstTradePnl < -0.01 ? "Biggest single loss" : "Worst open position",
    },
    {
      icon: "swap-horizontal-outline",
      label: "Total Trades",
      value: `${stats.totalTrades}`,
      valueColor: colors.text,
      iconColor: Colors.accentLight,
      iconBg: Colors.accentBg,
      hint: "All-time executions",
    },
    {
      icon: "calendar-outline",
      label: "Active Since",
      value: activeSinceStr,
      valueColor: colors.text,
      iconColor: colors.textSecondary,
      iconBg: colors.cardSecondary,
      hint: "First trade date",
    },
  ];

  return (
    <View style={{ gap: 10 }}>
      {[0, 2, 4, 6].map((startIdx) => (
        <View key={startIdx} style={{ flexDirection: "row", gap: 10 }}>
          {cards.slice(startIdx, startIdx + 2).map((card) => (
            <View
              key={card.label}
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
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    backgroundColor: card.iconBg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={card.icon as any} size={17} color={card.iconColor} />
                </View>
              </View>
              <Text
                style={{
                  color: card.valueColor,
                  fontSize: card.value.length > 10 ? 13 : 17,
                  fontWeight: "800",
                  letterSpacing: -0.3,
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {card.value}
              </Text>
              <View style={{ gap: 1, marginTop: -4 }}>
                <Text
                  style={{
                    color: colors.textTertiary,
                    fontSize: 10,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {card.label}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────
function HoldingsSkeleton({ colors, isDark }: { colors: any; isDark: boolean }) {
  const skBg = isDark ? Colors.dark.skeleton : Colors.light.skeleton;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, overflow: "hidden" }}>
      {[0, 1, 2].map((i) => (
        <View key={i}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 12 }}>
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: skBg }} />
            <View style={{ flex: 1, gap: 6 }}>
              <View style={{ width: 60, height: 13, borderRadius: 6, backgroundColor: skBg }} />
              <View style={{ width: 110, height: 10, borderRadius: 5, backgroundColor: skBg }} />
            </View>
            <View style={{ width: 56, height: 26, borderRadius: 6, backgroundColor: skBg }} />
            <View style={{ alignItems: "flex-end", gap: 5 }}>
              <View style={{ width: 70, height: 13, borderRadius: 6, backgroundColor: skBg }} />
              <View style={{ width: 90, height: 18, borderRadius: 6, backgroundColor: skBg }} />
            </View>
          </View>
          {i < 2 && <View style={{ height: 1, backgroundColor: colors.divider, marginHorizontal: 16 }} />}
        </View>
      ))}
    </View>
  );
}

function StatsSkeleton({ colors }: { colors: any }) {
  return (
    <View style={{ gap: 10 }}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={{ flexDirection: "row", gap: 10 }}>
          {[0, 1].map((col) => (
            <View
              key={col}
              style={{
                flex: 1,
                backgroundColor: colors.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                height: 90,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function QuickStatCard({
  label, value, icon, iconColor, iconBg, colors,
}: {
  label: string; value: React.ReactNode;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string; iconBg: string; colors: any;
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
          width: 34, height: 34, borderRadius: 10,
          backgroundColor: iconBg, alignItems: "center", justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={17} color={iconColor} />
      </View>
      {value}
      <Text
        style={{
          color: colors.textTertiary, fontSize: 10, fontWeight: "600",
          textTransform: "uppercase", letterSpacing: 0.4, marginTop: -4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function QuickAction({
  icon, label, onPress, accent, accentBg, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap; label: string;
  onPress: () => void; accent: string; accentBg: string; colors: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1, backgroundColor: colors.card, borderWidth: 1,
        borderColor: colors.cardBorder, borderRadius: 16, padding: 14,
        alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 42, height: 42, borderRadius: 13,
          backgroundColor: accentBg, alignItems: "center", justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 11, textAlign: "center" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function AgentCard({ agent, colors, isDark, onPress }: {
  agent: Agent; colors: any; isDark: boolean; onPress: () => void;
}) {
  const dotColor = STATUS_DOT[agent.status] ?? colors.textTertiary;
  const isActive = agent.status === "active";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card, borderRadius: 16, borderWidth: 1,
        borderColor: colors.cardBorder, padding: 16, opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 46, height: 46, borderRadius: 14, backgroundColor: Colors.accentBg,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name="hardware-chip-outline" size={22} color={Colors.accentLight} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{agent.name}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {isActive
              ? <PulsingDot color={dotColor} size={7} />
              : <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: dotColor }} />
            }
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{agent.strategy}</Text>
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>·</Text>
            <Badge
              label={agent.mode === "live" ? "Live" : "Paper"}
              variant={agent.mode === "live" ? "live" : "paper"}
              dot size="sm"
            />
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <AnimatedNumber
            value={agent.pnl}
            formatter={(v) => formatCurrency(v, true)}
            style={{ color: agent.pnl >= 0 ? Colors.success : Colors.danger, fontWeight: "800", fontSize: 16 }}
          />
          <Text style={{ color: agent.pnl >= 0 ? Colors.success : Colors.danger, fontSize: 12, fontWeight: "600" }}>
            {formatPercent(agent.pnlPct)}
          </Text>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row", justifyContent: "space-between",
          marginTop: 14, paddingTop: 14,
          borderTopWidth: 1, borderTopColor: colors.divider,
        }}
      >
        {[
          { label: "Trades", value: `${agent.trades}` },
          { label: "Win Rate", value: agent.status === "backtesting" ? "—" : `${agent.winRate.toFixed(1)}%` },
          { label: "Max DD", value: agent.status === "backtesting" ? "—" : `${agent.maxDrawdown.toFixed(1)}%` },
          { label: "Sharpe", value: agent.status === "backtesting" ? "—" : `${agent.sharpeRatio.toFixed(1)}` },
        ].map((s) => (
          <View key={s.label} style={{ alignItems: "center", gap: 3 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3 }}>
              {s.label}
            </Text>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>{s.value}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function EmptyAgentsCard({ tradingMode, colors, isDark }: {
  tradingMode: TradingMode; colors: any; isDark: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.card, borderRadius: 20, borderWidth: 1,
        borderColor: colors.cardBorder, borderStyle: "dashed", padding: 32,
        alignItems: "center", gap: 12,
      }}
    >
      <View
        style={{
          width: 80, height: 80, borderRadius: 24, backgroundColor: Colors.accentBg,
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Ionicons name="hardware-chip-outline" size={40} color={Colors.accentLight} />
      </View>
      <View style={{ alignItems: "center", gap: 6 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center", letterSpacing: -0.4 }}>
          No {tradingMode === "live" ? "live" : "paper"} agents
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 260 }}>
          {tradingMode === "live"
            ? "Switch an agent to live mode or deploy a new one to start trading real money."
            : "Deploy your first AI trading agent in minutes. No coding required."}
        </Text>
      </View>
      <Button
        variant="primary" size="md"
        icon={<Ionicons name="add" size={16} color="#fff" />}
        onPress={() => router.push("/(tabs)/agents")}
      >
        Deploy Agent
      </Button>
    </View>
  );
}

function SectionHeader({
  title, subtitle, actionLabel, onAction, colors,
}: {
  title: string; subtitle?: string;
  actionLabel?: string; onAction?: () => void; colors: any;
}) {
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center",
        justifyContent: "space-between", marginTop: 4,
      }}
    >
      <View style={{ gap: 1 }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 }}>
          {title}
        </Text>
        {subtitle && (
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{subtitle}</Text>
        )}
      </View>
      {actionLabel && onAction && (
        <Pressable onPress={onAction}>
          <Text style={{ color: Colors.accent, fontWeight: "600", fontSize: 13 }}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
