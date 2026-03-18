import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Share,
  Platform,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { fetchAgentTrades, fetchPublicAgent, type DbTrade } from "@/lib/services/agentService";
import { fetchLastSignal, fetchAgentLogs } from "@/lib/services/debugService";
import {
  fetchFollowedAgentIds,
  followAgent,
  unfollowAgent,
} from "@/lib/services/leaderboardService";
import { invokeRunAgents } from "@/lib/services/functionService";
import { formatCurrency, formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { STRATEGIES, RISK_CONFIG, AI_MODELS, TIME_HORIZONS } from "@/constants/strategies";
import type { StrategyId, ModelId } from "@/constants/strategies";
import type { Agent } from "@/store/agentStore";
import { CommentSection } from "@/components/social/CommentSection";

const STATUS_BADGES: Record<string, { variant: any; label: string }> = {
  active: { variant: "success", label: "Active" },
  paused: { variant: "warning", label: "Paused" },
  stopped: { variant: "danger", label: "Stopped" },
  backtesting: { variant: "accent", label: "Backtesting" },
};

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();
  const { agents, toggleAgent, deleteAgent } = useAgentStore();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [publicOwnerName, setPublicOwnerName] = useState<string>("");
  const [publicOwnerAvatar, setPublicOwnerAvatar] = useState<string>("🚀");
  const [isOwnAgent, setIsOwnAgent] = useState(false);
  const [trades, setTrades] = useState<DbTrade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followCount, setFollowCount] = useState(0);
  const [runResult, setRunResult] = useState<{ title: string; message: string; ok: boolean } | null>(null);
  const [lastSignalAt, setLastSignalAt] = useState<string | null>(null);
  const [lastTradeReasoning, setLastTradeReasoning] = useState<string | null>(null);

  // Fade-in on mount (native driver only — web always visible)
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, []);

  // Load agent — from store (own) or from DB (public)
  useEffect(() => {
    if (!id) return;

    async function load() {
      setPageLoading(true);

      // Check own store first
      const ownAgent = agents.find((a) => a.id === id);
      if (ownAgent) {
        setAgent(ownAgent);
        setIsOwnAgent(true);
        setPageLoading(false);
      } else {
        // Fetch from DB (other user's public agent)
        const { data } = await fetchPublicAgent(id);
        if (data) {
          setAgent({
            id: data.id,
            userId: data.user_id,
            name: data.name,
            strategy: data.strategy as StrategyId,
            status: data.status,
            pnl: Number(data.pnl),
            pnlPct: Number(data.pnl_pct),
            trades: data.trades_count,
            winRate: Number(data.win_rate),
            createdAt: new Date(data.created_at).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            }),
            mode: data.mode,
            description: data.description,
            maxDrawdown: Number(data.max_drawdown),
            sharpeRatio: Number(data.sharpe_ratio),
            config: data.config ?? {},
            budget: Number(data.budget ?? 1000),
            isPrivate: data.is_private ?? false,
            modelId: (data.model_id as ModelId) ?? "groq_llama",
          });
          setPublicOwnerName(data.profiles?.display_name ?? "Trader");
          setPublicOwnerAvatar(data.profiles?.avatar ?? "🚀");
          setIsOwnAgent(data.user_id === authUser?.id);
        }
        setPageLoading(false);
      }

      // Load trades
      const { data: tradeData } = await fetchAgentTrades(id, 50);
      setTrades(tradeData ?? []);
      setTradesLoading(false);

      // Load last signal timestamp
      const lastSig = await fetchLastSignal(id);
      setLastSignalAt(lastSig);

      // For News Trader and Blind Quant: load the last trade's reasoning
      const agentStrategy = agents.find((a) => a.id === id)?.strategy;
      if (agentStrategy === "news_trader" || agentStrategy === "blind_quant") {
        const userId = agents.find((a) => a.id === id)?.userId ?? authUser?.id ?? "";
        if (userId) {
          const logs = await fetchAgentLogs(userId, id, 10);
          const lastTrade = logs.find((l) => l.action === "traded");
          if (lastTrade?.ai_reasoning) setLastTradeReasoning(lastTrade.ai_reasoning);
        }
      }

      // Load follow state
      if (authUser?.id) {
        const followed = await fetchFollowedAgentIds(authUser.id);
        setIsFollowing(followed.has(id));
      }
    }

    load();
  }, [id, authUser?.id]);

  // Keep agent in sync with store changes (for own agents)
  useEffect(() => {
    if (!isOwnAgent || !id) return;
    const updated = agents.find((a) => a.id === id);
    if (updated) setAgent(updated);
  }, [agents, id, isOwnAgent]);

  const handleToggle = useCallback(async () => {
    if (!agent || !isOwnAgent) return;
    setActionLoading(true);
    await toggleAgent(agent.id);
    setActionLoading(false);
  }, [agent, isOwnAgent, toggleAgent]);

  const handleDelete = useCallback(() => {
    if (!agent || !isOwnAgent) return;
    Alert.alert(
      "Delete Agent",
      `Are you sure you want to permanently delete "${agent.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setActionLoading(true);
            const { error } = await deleteAgent(agent.id);
            setActionLoading(false);
            if (error) Alert.alert("Error", "Failed to delete agent.");
            else router.back();
          },
        },
      ]
    );
  }, [agent, isOwnAgent, deleteAgent, router]);

  // Cross-platform notify: banner in UI (always works) + native Alert on iOS/Android
  const notify = useCallback((title: string, message: string, ok: boolean) => {
    console.log("EDGE FUNCTION RESPONSE:", { title, message, ok });
    setRunResult({ title, message, ok });
    if (Platform.OS !== "web") {
      Alert.alert(title, message);
    }
  }, []);

  const handleRunNow = useCallback(async () => {
    if (!agent) return;
    setRunLoading(true);
    setRunResult(null);
    try {
      // force=true bypasses the market-hours gate so Run Now always executes for testing
      const result = await invokeRunAgents(agent.id, true);

      console.log("EDGE FUNCTION RESPONSE:", JSON.stringify(result));

      if (!result.ok) {
        notify("Run Failed", result.error ?? "Something went wrong. Check your connection and try again.", false);
        return;
      }

      if (result.marketClosed) {
        notify("Market Closed", "Market is closed. Trades will execute automatically during market hours (9:30 AM – 4:00 PM ET, Mon–Fri).", false);
        return;
      }

      const r = result.results?.[0];

      if (!r) {
        notify("No Result", "Agent returned no result. Make sure the agent exists and try again.", false);
        return;
      }

      if (r.skipped) {
        const reason = r.skipReason ?? "";
        if (reason.toLowerCase().includes("no signal") || reason.toLowerCase().includes("signal generated")) {
          notify("No Signal Found", "No trade signal found. The strategy saw no actionable opportunity right now.", false);
        } else if (reason.toLowerCase().includes("market")) {
          notify("Market Closed", "Market is closed. Trades will execute automatically during market hours (9:30 AM – 4:00 PM ET, Mon–Fri).", false);
        } else if (reason.toLowerCase().includes("daily loss")) {
          notify("Risk Limit Reached", `Daily loss limit hit for today. Trading is paused until tomorrow.\n\n${r.skipReason}`, false);
        } else if (reason.toLowerCase().includes("budget fully deployed")) {
          notify("Budget Deployed", "All available budget is already in open positions. Close a position to free up capital.", false);
        } else if (reason.toLowerCase().includes("ai rejected") || reason.toLowerCase().includes("confidence")) {
          notify("AI Skipped Trade", `The AI model decided not to trade.\n\n${r.skipReason}`, false);
        } else if (reason.toLowerCase().includes("qty") || reason.toLowerCase().includes("size too small")) {
          notify("Trade Too Small", "Position size rounds to zero at current prices. Increase your budget or adjust parameters.", false);
        } else {
          notify("No Trade", r.skipReason ?? "No trade signal found.", false);
        }
      } else if (r.success) {
        const pnlStr = r.pnl !== undefined && r.pnl !== 0
          ? `  ·  P&L: ${r.pnl >= 0 ? "+" : ""}$${r.pnl.toFixed(2)}` : "";
        notify(
          "Trade Executed ✓",
          `${r.side?.toUpperCase()} ${r.qty} ${r.symbol} @ $${r.price?.toFixed(2)}${pnlStr}\n\n${r.aiReasoning}`,
          true
        );
        fetchAgentTrades(agent.id, 50).then(({ data }) => setTrades(data ?? []));
      } else {
        notify("Trade Failed", r.error ?? "Execution error. The order may have been rejected by the broker.", false);
      }
    } catch (err: any) {
      console.error("EDGE FUNCTION ERROR:", err);
      notify("Unexpected Error", err?.message ?? "Something went wrong running the agent.", false);
    } finally {
      setRunLoading(false);
    }
  }, [agent, notify]);

  const handleShare = useCallback(async () => {
    if (!agent) return;
    const strategyDef = STRATEGIES.find((s) => s.id === (agent.strategy as StrategyId));
    const sign = agent.pnl >= 0 ? "+" : "";
    const message =
      `🤖 ${agent.name} — AgentVault\n` +
      `Strategy: ${strategyDef?.name ?? agent.strategy}\n` +
      `Return: ${sign}${agent.pnlPct.toFixed(2)}%\n` +
      `P&L: ${sign}$${agent.pnl.toFixed(2)}\n` +
      `Trades: ${agent.trades} · Win Rate: ${agent.winRate}%\n\n` +
      `Track AI trading agents on AgentVault`;
    await Share.share({ message });
  }, [agent]);

  const handleFollow = useCallback(async () => {
    if (!authUser?.id || !agent) return;
    const nextFollowing = !isFollowing;
    setIsFollowing(nextFollowing);
    setFollowCount((c) => c + (nextFollowing ? 1 : -1));

    const { error } = nextFollowing
      ? await followAgent(authUser.id, agent.id)
      : await unfollowAgent(authUser.id, agent.id);

    if (error) {
      setIsFollowing(!nextFollowing);
      setFollowCount((c) => c + (nextFollowing ? -1 : 1));
    }
  }, [authUser?.id, agent, isFollowing]);

  if (pageLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!agent) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textTertiary} />
          <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Agent not found</Text>
          <Button variant="ghost" size="sm" onPress={() => router.back()}>Go Back</Button>
        </View>
      </SafeAreaView>
    );
  }

  const sb = STATUS_BADGES[agent.status];
  const canToggle = isOwnAgent && (agent.status === "active" || agent.status === "paused");
  const strategyDef = STRATEGIES.find((s) => s.id === (agent.strategy as StrategyId));
  const modelDef = AI_MODELS.find((m) => m.id === (agent.modelId as ModelId));
  const riskConfig = strategyDef ? RISK_CONFIG[strategyDef.risk] : null;
  const timeHorizonDef = TIME_HORIZONS.find((h) => h.id === (agent.config?.time_horizon ?? "medium")) ?? TIME_HORIZONS[1];
  const isPositive = agent.pnl >= 0;

  return (
    <Animated.View style={{ flex: 1, opacity: Platform.OS === "web" ? 1 : fadeAnim }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 12,
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            width: 38, height: 38, borderRadius: 12,
            backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text
            style={{ color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.4 }}
            numberOfLines={1}
          >
            {agent.name}
          </Text>
          {!isOwnAgent && (
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
              {publicOwnerAvatar} {publicOwnerName}
            </Text>
          )}
        </View>

        {/* Right-side actions */}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {/* Share button — always visible */}
          <Pressable
            onPress={handleShare}
            hitSlop={12}
            style={{
              width: 38, height: 38, borderRadius: 12,
              backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="share-outline" size={18} color={colors.text} />
          </Pressable>

          {isOwnAgent && (
            <Pressable
              onPress={handleDelete}
              hitSlop={12}
              style={{
                width: 38, height: 38, borderRadius: 12,
                backgroundColor: Colors.dangerBg,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
            </Pressable>
          )}

          {!isOwnAgent && (
            <Pressable
              onPress={handleFollow}
              style={{
                height: 38, paddingHorizontal: 14, borderRadius: 12,
                backgroundColor: isFollowing ? Colors.accentBg : colors.card,
                borderWidth: 1.5,
                borderColor: isFollowing ? Colors.accent : colors.cardBorder,
                flexDirection: "row", alignItems: "center", gap: 6,
              }}
            >
              <Ionicons
                name={isFollowing ? "heart" : "heart-outline"}
                size={16}
                color={isFollowing ? Colors.accent : colors.textSecondary}
              />
              <Text
                style={{
                  color: isFollowing ? Colors.accentLight : colors.textSecondary,
                  fontWeight: "700", fontSize: 13,
                }}
              >
                {isFollowing ? "Following" : "Follow"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 16, paddingBottom: 32 }}
      >
        {/* Hero P&L */}
        <View
          style={{
            backgroundColor: isPositive ? Colors.successBg : Colors.dangerBg,
            borderRadius: 20, padding: 20, gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 28 }}>{strategyDef?.icon ?? "🤖"}</Text>
            <Badge label={sb.label} variant={sb.variant} size="md" />
            <Badge
              label={agent.mode === "live" ? "Live" : "Paper"}
              variant={agent.mode === "live" ? "live" : "paper"}
              size="md" dot
            />
          </View>
          <Text
            style={{
              color: isPositive ? Colors.success : Colors.danger,
              fontSize: 40, fontWeight: "900", letterSpacing: -1,
            }}
          >
            {formatCurrency(agent.pnl, true)}
          </Text>
          <Text style={{ color: isPositive ? Colors.success : Colors.danger, fontSize: 16, fontWeight: "600" }}>
            {formatPercent(agent.pnlPct)} total return
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 4 }}>
            Budget: {formatCurrency(agent.budget)} · Deployed {agent.createdAt}
          </Text>
        </View>

        {/* Stats Grid */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {[
            { label: "Trades", value: `${agent.trades}`, icon: "swap-horizontal-outline" },
            { label: "Win Rate", value: agent.trades === 0 ? "—" : `${agent.winRate}%`, icon: "trophy-outline" },
            { label: "Max DD", value: agent.trades === 0 ? "—" : `${agent.maxDrawdown}%`, icon: "trending-down-outline" },
            { label: "Sharpe", value: agent.trades === 0 ? "—" : `${agent.sharpeRatio}`, icon: "analytics-outline" },
          ].map((s) => (
            <View
              key={s.label}
              style={{
                flex: 1, backgroundColor: colors.card, borderRadius: 14,
                borderWidth: 1, borderColor: colors.cardBorder,
                padding: 12, alignItems: "center", gap: 4,
              }}
            >
              <Ionicons name={s.icon as any} size={16} color={colors.textSecondary} />
              <Text style={{ color: colors.text, fontWeight: "800", fontSize: 16 }}>{s.value}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: "600", textTransform: "uppercase" }}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Own-agent controls ───────────────────────────────── */}
        {isOwnAgent && (
          <>
            {/* Auto-trading status badge */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: agent.status === "active" ? Colors.successBg : "rgba(139,143,168,0.12)",
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: agent.status === "active" ? Colors.success + "40" : "rgba(139,143,168,0.25)",
              }}
            >
              <Ionicons
                name={agent.status === "active" ? "flash" : "pause-circle-outline"}
                size={20}
                color={agent.status === "active" ? Colors.success : "#8B8FA8"}
              />
              <View style={{ flex: 1 }}>
                <Text style={{
                  color: agent.status === "active" ? Colors.success : "#8B8FA8",
                  fontWeight: "700", fontSize: 14,
                }}>
                  {agent.status === "active" ? "Auto-trading during market hours" : "Paused — not trading"}
                </Text>
                <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>
                  {agent.status === "active"
                    ? "Runs every 15 min · Mon–Fri · 9:30 AM–4 PM ET"
                    : "Resume to enable automatic cron execution"}
                </Text>
              </View>
            </View>

            {/* Primary toggle */}
            {canToggle && (
              <View
                style={{
                  backgroundColor: colors.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  padding: 4,
                  flexDirection: "row",
                  gap: 4,
                }}
              >
                {([
                  { status: "active", label: "Active", icon: "flash" as const },
                  { status: "paused", label: "Paused", icon: "pause-circle" as const },
                ] as const).map(({ status, label, icon }) => {
                  const selected = agent.status === status;
                  return (
                    <Pressable
                      key={status}
                      onPress={() => !selected && !actionLoading && handleToggle()}
                      disabled={actionLoading}
                      style={{
                        flex: 1,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                        paddingVertical: 13,
                        borderRadius: 13,
                        backgroundColor: selected
                          ? status === "active" ? Colors.accent : colors.cardSecondary
                          : "transparent",
                        opacity: actionLoading ? 0.6 : 1,
                      }}
                    >
                      {actionLoading && selected ? (
                        <ActivityIndicator size="small" color={status === "active" ? "#fff" : colors.textSecondary} />
                      ) : (
                        <Ionicons
                          name={icon}
                          size={16}
                          color={selected ? (status === "active" ? "#fff" : colors.textSecondary) : colors.textTertiary}
                        />
                      )}
                      <Text style={{
                        fontWeight: "700",
                        fontSize: 15,
                        color: selected ? (status === "active" ? "#fff" : colors.text) : colors.textTertiary,
                      }}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Test Run result banner */}
            {runResult && (
              <Pressable
                onPress={() => setRunResult(null)}
                style={{
                  backgroundColor: runResult.ok ? Colors.successBg : Colors.dangerBg,
                  borderRadius: 14, padding: 14, borderWidth: 1,
                  borderColor: runResult.ok ? Colors.success : Colors.danger, gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons
                    name={runResult.ok ? "checkmark-circle" : "alert-circle"}
                    size={18}
                    color={runResult.ok ? Colors.success : Colors.danger}
                  />
                  <Text style={{ color: runResult.ok ? Colors.success : Colors.danger, fontWeight: "700", fontSize: 14, flex: 1 }}>
                    {runResult.title}
                  </Text>
                  <Ionicons name="close" size={14} color={runResult.ok ? Colors.success : Colors.danger} />
                </View>
                <Text style={{ color: runResult.ok ? Colors.success : Colors.danger, fontSize: 13, lineHeight: 18, opacity: 0.85, paddingLeft: 26 }}>
                  {runResult.message}
                </Text>
              </Pressable>
            )}

            {/* Secondary: Test Run */}
            <Pressable
              onPress={handleRunNow}
              disabled={runLoading}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                paddingVertical: 11,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                backgroundColor: colors.cardSecondary,
                opacity: runLoading ? 0.6 : 1,
              }}
            >
              {runLoading
                ? <ActivityIndicator size="small" color={colors.textSecondary} />
                : <Ionicons name="play-circle-outline" size={16} color={colors.textSecondary} />
              }
              <Text style={{ color: colors.textSecondary, fontWeight: "600", fontSize: 14 }}>
                {runLoading ? "Running…" : "Test Run"}
              </Text>
              <View style={{
                backgroundColor: colors.cardBorder,
                paddingHorizontal: 6, paddingVertical: 2,
                borderRadius: 5, marginLeft: 2,
              }}>
                <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: "700" }}>
                  FORCES EXECUTE
                </Text>
              </View>
            </Pressable>
          </>
        )}

        {/* Configuration */}
        {strategyDef && (
          <Card>
            <Text
              style={{
                color: colors.textSecondary, fontSize: 11, fontWeight: "700",
                textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12,
              }}
            >
              Configuration
            </Text>
            <InfoRow label="Strategy" value={strategyDef.name} icon="layers-outline" colors={colors} />
            {riskConfig && <InfoRow label="Risk Level" value={riskConfig.label} icon="shield-outline" colors={colors} />}
            {modelDef && (
              <InfoRow
                label="AI Model"
                value={`${modelDef.icon} ${modelDef.name}`}
                icon="hardware-chip-outline"
                colors={colors}
              />
            )}
            <InfoRow
              label="Time Horizon"
              value={`${timeHorizonDef.icon} ${timeHorizonDef.name} (${timeHorizonDef.subtitle})`}
              icon="time-outline"
              colors={colors}
            />
            <InfoRow
              label="Visibility"
              value={agent.isPrivate ? "Private" : "Public"}
              icon={agent.isPrivate ? "eye-off-outline" : "eye-outline"}
              colors={colors}
            />
            {agent.config.aggressive_mode && (
              <InfoRow
                label="Aggressive Mode"
                value="On — looser signals"
                icon="flash-outline"
                colors={colors}
              />
            )}
            <InfoRow
              label="Last Signal"
              value={lastSignalAt
                ? new Date(lastSignalAt).toLocaleString("en-US", {
                    month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })
                : "No signal yet"}
              icon="radio-outline"
              colors={colors}
            />

            {agent.strategy === "custom" && agent.config.strategy_prompt ? (
              <>
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 12 }} />
                <Text
                  style={{
                    color: colors.textTertiary, fontSize: 11, fontWeight: "600",
                    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
                  }}
                >
                  Strategy Instructions
                </Text>
                <View
                  style={{
                    backgroundColor: Colors.accentBg,
                    borderRadius: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: Colors.accent + "30",
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="create-outline" size={13} color={Colors.accentLight} />
                    <Text style={{ color: Colors.accentLight, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      AI-Interpreted Rules
                    </Text>
                  </View>
                  <Text style={{ color: Colors.accentLight, fontSize: 13, lineHeight: 19, opacity: 0.9 }}>
                    {agent.config.strategy_prompt as string}
                  </Text>
                </View>
              </>
            ) : (agent.strategy === "news_trader" || agent.strategy === "blind_quant") && lastTradeReasoning ? (
              <>
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 12 }} />
                <Text
                  style={{
                    color: colors.textTertiary, fontSize: 11, fontWeight: "600",
                    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
                  }}
                >
                  {agent.strategy === "news_trader" ? "Last Trade — Headlines" : "Last Trade — Quant Data"}
                </Text>
                <View
                  style={{
                    backgroundColor: agent.strategy === "news_trader"
                      ? "rgba(255,169,77,0.08)"
                      : "rgba(99,102,241,0.08)",
                    borderRadius: 12,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: agent.strategy === "news_trader"
                      ? "rgba(255,169,77,0.25)"
                      : "rgba(99,102,241,0.25)",
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 13 }}>
                      {agent.strategy === "news_trader" ? "🗞️" : "🔢"}
                    </Text>
                    <Text style={{
                      color: agent.strategy === "news_trader" ? "#FFA94D" : "#818CF8",
                      fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4,
                    }}>
                      {agent.strategy === "news_trader" ? "AI Sentiment Analysis" : "Anonymous Quant Signal"}
                    </Text>
                  </View>
                  <Text style={{
                    color: agent.strategy === "news_trader" ? "#FFA94D" : "#818CF8",
                    fontSize: 12, lineHeight: 18, opacity: 0.85,
                  }}>
                    {lastTradeReasoning.slice(0, 400)}
                  </Text>
                </View>
              </>
            ) : strategyDef.params.length > 0 && Object.keys(agent.config).length > 0 ? (
              <>
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 12 }} />
                <Text
                  style={{
                    color: colors.textTertiary, fontSize: 11, fontWeight: "600",
                    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
                  }}
                >
                  Parameters
                </Text>
                {strategyDef.params.map((p) => {
                  const val = agent.config[p.key] ?? p.default;
                  return (
                    <InfoRow
                      key={p.key}
                      label={p.label}
                      value={p.unit.startsWith("$") ? `$${val}` : `${val}${p.unit}`}
                      colors={colors}
                    />
                  );
                })}
              </>
            ) : null}
          </Card>
        )}

        {/* Trade History */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>
            Trade History
          </Text>
          {tradesLoading ? (
            <View style={{ padding: 24, alignItems: "center" }}>
              <ActivityIndicator color={Colors.accent} />
            </View>
          ) : trades.length === 0 ? (
            <Card>
              <View style={{ alignItems: "center", gap: 8, paddingVertical: 8 }}>
                <Ionicons name="swap-horizontal-outline" size={36} color={colors.textTertiary} />
                <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
                  No trades yet.
                </Text>
              </View>
            </Card>
          ) : (
            trades.map((trade) => <TradeRow key={trade.id} trade={trade} colors={colors} />)
          )}
        </View>

        {/* Comments */}
        <View style={{ paddingTop: 4 }}>
          <CommentSection agentId={agent.id} />
        </View>
      </ScrollView>
    </SafeAreaView>
    </Animated.View>
  );
}

function InfoRow({ label, value, icon, colors }: { label: string; value: string; icon?: string; colors: any }) {
  return (
    <View
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {icon && <Ionicons name={icon as any} size={15} color={colors.textSecondary} />}
        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{label}</Text>
      </View>
      <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>{value}</Text>
    </View>
  );
}

function TradeRow({ trade, colors }: { trade: DbTrade; colors: any }) {
  const isBuy = trade.side === "buy";
  const pnl = Number(trade.pnl);
  const isProfit = pnl >= 0;
  const date = new Date(trade.executed_at);
  const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  return (
    <View
      style={{
        backgroundColor: colors.card, borderRadius: 14, borderWidth: 1,
        borderColor: colors.cardBorder, padding: 14,
        flexDirection: "row", alignItems: "center", gap: 12,
      }}
    >
      <View
        style={{
          width: 40, height: 40, borderRadius: 12,
          backgroundColor: isBuy ? Colors.successBg : Colors.dangerBg,
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Ionicons
          name={isBuy ? "arrow-down-circle" : "arrow-up-circle"}
          size={22}
          color={isBuy ? Colors.success : Colors.danger}
        />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>{trade.symbol}</Text>
          <Badge label={trade.side.toUpperCase()} variant={isBuy ? "success" : "danger"} />
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {Number(trade.quantity).toFixed(4)} @ {formatCurrency(Number(trade.price))} · {dateStr} {timeStr}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text
          style={{
            color: isProfit ? Colors.success : pnl === 0 ? colors.textSecondary : Colors.danger,
            fontWeight: "700", fontSize: 14,
          }}
        >
          {pnl === 0 ? "—" : formatCurrency(pnl, true)}
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11 }}>P&L</Text>
      </View>
    </View>
  );
}
