import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  ActivityIndicator,
  Share,
  Switch,
  Platform,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { fetchAgentTrades, fetchPublicAgent, updateAgentPrivacy, type DbTrade } from "@/lib/services/agentService";
import { supabase } from "@/lib/supabase";

interface StrategyGeneration {
  id: string;
  parent_id: string | null;
  generation_number: number;
  strategy_rules: string;
  mutation_description: string | null;
  status: "testing" | "graduated" | "killed";
  total_trades: number;
  total_pnl: number;
  win_rate: number;
  sharpe_ratio: number;
  vs_spy_pct: number;
  insight: string | null;
  graduated: boolean;
  killed: boolean;
  kill_reason: string | null;
  test_start_date: string;
  test_end_date: string | null;
  created_at: string;
}
import { fetchLastSignal, fetchAgentLogs } from "@/lib/services/debugService";
import { fetchAgentHoldings, getCompanyName, type AgentHolding } from "@/lib/services/holdingsService";
import { Sparkline } from "@/components/ui/Sparkline";
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [agentHoldings, setAgentHoldings] = useState<AgentHolding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(true);
  const [isPrivate, setIsPrivate] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [generations, setGenerations] = useState<StrategyGeneration[]>([]);
  const [generationsLoading, setGenerationsLoading] = useState(false);
  const [expandedRules, setExpandedRules] = useState<string | null>(null);

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
        setIsPrivate(ownAgent.isPrivate ?? false);
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

      // Load agent holdings
      const holdings = await fetchAgentHoldings(id);
      setAgentHoldings(holdings);
      setHoldingsLoading(false);

      // Load strategy generations (for Strategy Lab agents)
      if (agentStrategy === "strategy_lab") {
        setGenerationsLoading(true);
        const { data: genData } = await supabase
          .from("strategy_generations")
          .select("*")
          .eq("agent_id", id)
          .order("generation_number", { ascending: true });
        setGenerations((genData as StrategyGeneration[] | null) ?? []);
        setGenerationsLoading(false);
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
    setShowDeleteConfirm(true);
  }, [agent, isOwnAgent]);

  const confirmDelete = useCallback(async () => {
    if (!agent) return;
    setShowDeleteConfirm(false);
    setActionLoading(true);
    const { error } = await deleteAgent(agent.id);
    setActionLoading(false);
    if (error) Alert.alert("Error", "Failed to delete agent.");
    else router.back();
  }, [agent, deleteAgent, router]);

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

  const handlePrivacyToggle = useCallback(async (value: boolean) => {
    if (!agent || !isOwnAgent) return;
    // Check plan for Pro/Pro+ requirement
    const plan = authUser?.user_metadata?.plan ?? "free";
    if (plan === "free") {
      Alert.alert("Pro Required", "Public agents require a Pro or Pro+ subscription.");
      return;
    }
    setPrivacyLoading(true);
    setIsPrivate(value);
    const { error } = await updateAgentPrivacy(agent.id, value);
    if (error) {
      setIsPrivate(!value);
      Alert.alert("Error", "Failed to update privacy setting.");
    }
    setPrivacyLoading(false);
  }, [agent, isOwnAgent, authUser]);

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

            {/* Privacy Toggle */}
            {(() => {
              const plan = authUser?.user_metadata?.plan ?? "free";
              const isPro = plan === "pro" || plan === "elite";
              return (
                <View
                  style={{
                    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1,
                    borderColor: colors.cardBorder, padding: 14,
                    flexDirection: "row", alignItems: "center", gap: 12,
                    opacity: isPro ? 1 : 0.6,
                  }}
                >
                  <View
                    style={{
                      width: 38, height: 38, borderRadius: 11,
                      backgroundColor: isPrivate ? Colors.accentBg : Colors.successBg,
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={isPrivate ? "lock-closed-outline" : "globe-outline"}
                      size={18}
                      color={isPrivate ? Colors.accentLight : Colors.success}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
                      {isPrivate ? "Private Agent" : "Public Agent"}
                    </Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 1 }}>
                      {isPro
                        ? (isPrivate ? "Only you can see this agent" : "Visible on leaderboard and social")
                        : "Upgrade to Pro to make agents public"}
                    </Text>
                  </View>
                  {isPro ? (
                    <Switch
                      value={!isPrivate}
                      onValueChange={(v) => handlePrivacyToggle(!v)}
                      disabled={privacyLoading}
                      trackColor={{ false: colors.cardBorder, true: Colors.accentBg }}
                      thumbColor={!isPrivate ? Colors.accent : colors.textTertiary}
                      ios_backgroundColor={colors.cardBorder}
                    />
                  ) : (
                    <Ionicons name="lock-closed" size={18} color={colors.textTertiary} />
                  )}
                </View>
              );
            })()}
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

        {/* ── Strategy Lab Section ──────────────────────────────────── */}
        {agent.strategy === "strategy_lab" && (
          <StrategyLabSection
            generations={generations}
            loading={generationsLoading}
            expandedRules={expandedRules}
            onToggleRules={(id) => setExpandedRules((prev) => (prev === id ? null : id))}
            colors={colors}
          />
        )}

        {/* ── Holdings Section ──────────────────────────────────────── */}
        <AgentHoldingsSection
          holdings={agentHoldings}
          loading={holdingsLoading}
          colors={colors}
        />

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

      {/* Delete confirmation modal — cross-platform (Alert.alert breaks on web) */}
      <Modal visible={showDeleteConfirm} transparent animationType="fade" onRequestClose={() => setShowDeleteConfirm(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center", padding: 24 }}
          onPress={() => setShowDeleteConfirm(false)}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360 }}>
            <View style={{ backgroundColor: colors.card, borderRadius: 20, padding: 24, gap: 20, borderWidth: 1, borderColor: colors.cardBorder }}>
              <View style={{ alignItems: "center", gap: 12 }}>
                <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.dangerBg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="trash-outline" size={26} color={Colors.danger} />
                </View>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" }}>Delete Agent?</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
                  <Text style={{ fontWeight: "700", color: colors.text }}>"{agent.name}"</Text>
                  {" "}will be permanently deleted along with all its trades and logs. This cannot be undone.
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => setShowDeleteConfirm(false)}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.cardSecondary, alignItems: "center", borderWidth: 1, borderColor: colors.cardBorder }}
                >
                  <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={confirmDelete}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.danger, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
    </Animated.View>
  );
}

// ─── Agent Holdings Section ───────────────────────────────────────────────────
function AgentHoldingsSection({
  holdings,
  loading,
  colors,
}: {
  holdings: AgentHolding[];
  loading: boolean;
  colors: any;
}) {
  if (loading) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>Holdings</Text>
        <View
          style={{
            backgroundColor: colors.card, borderRadius: 16, borderWidth: 1,
            borderColor: colors.cardBorder, padding: 14, gap: 12,
          }}
        >
          {[0, 1].map((i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.cardSecondary }} />
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ width: 60, height: 12, borderRadius: 5, backgroundColor: colors.cardSecondary }} />
                <View style={{ width: 100, height: 10, borderRadius: 5, backgroundColor: colors.cardSecondary }} />
              </View>
              <View style={{ alignItems: "flex-end", gap: 5 }}>
                <View style={{ width: 70, height: 12, borderRadius: 5, backgroundColor: colors.cardSecondary }} />
                <View style={{ width: 80, height: 18, borderRadius: 5, backgroundColor: colors.cardSecondary }} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (holdings.length === 0) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>Holdings</Text>
        <View
          style={{
            backgroundColor: colors.card, borderRadius: 16, borderWidth: 1,
            borderColor: colors.cardBorder, padding: 20,
            alignItems: "center", gap: 8,
          }}
        >
          <Ionicons name="pie-chart-outline" size={28} color={colors.textTertiary} />
          <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: "center" }}>
            No open positions. This agent hasn't made any trades yet.
          </Text>
        </View>
      </View>
    );
  }

  const totalPnl = holdings.reduce((s, h) => s + h.unrealizedPnl, 0);
  const longHoldings = holdings.filter((h) => h.quantity > 0);
  const shortHoldings = holdings.filter((h) => h.quantity < 0);
  const longValue = longHoldings.reduce((s, h) => s + h.currentValue, 0);
  const isPnlPositive = totalPnl >= 0;

  return (
    <View style={{ gap: 10 }}>
      {/* Header row */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>
          Holdings
          {shortHoldings.length > 0 && (
            <Text style={{ color: "#818CF8", fontSize: 13, fontWeight: "600" }}>
              {" "}· {shortHoldings.length} short
            </Text>
          )}
        </Text>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(longValue)} long
          </Text>
          <Text
            style={{
              color: isPnlPositive ? Colors.success : Colors.danger,
              fontSize: 12, fontWeight: "600",
            }}
          >
            {isPnlPositive ? "+" : ""}
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalPnl)} unrealized
          </Text>
        </View>
      </View>

      {/* Holdings card */}
      <View
        style={{
          backgroundColor: colors.card, borderRadius: 18, borderWidth: 1,
          borderColor: colors.cardBorder, overflow: "hidden",
        }}
      >
        {holdings.map((h, i) => {
          const isShort = h.quantity < 0;
          const isUp = h.unrealizedPnl >= 0;
          const pnlColor = isUp ? Colors.success : Colors.danger;
          const absQty = Math.abs(h.quantity);
          return (
            <View key={h.symbol}>
              <View style={{ flexDirection: "row", alignItems: "center", padding: 14, gap: 12 }}>
                {/* Ticker badge */}
                <View
                  style={{
                    width: 42, height: 42, borderRadius: 13,
                    backgroundColor: isShort ? "rgba(129,140,248,0.12)" : (isUp ? Colors.successBg : Colors.dangerBg),
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Text style={{
                    color: isShort ? "#818CF8" : pnlColor,
                    fontWeight: "800", fontSize: 11, letterSpacing: -0.3,
                  }}>
                    {h.symbol.slice(0, 4)}
                  </Text>
                </View>

                {/* Name + detail */}
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
                      {h.symbol}
                    </Text>
                    {isShort && (
                      <View style={{
                        backgroundColor: "rgba(129,140,248,0.15)", paddingHorizontal: 5,
                        paddingVertical: 1, borderRadius: 4,
                      }}>
                        <Text style={{ color: "#818CF8", fontSize: 9, fontWeight: "800", letterSpacing: 0.3 }}>
                          SHORT
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: colors.textTertiary, fontSize: 11 }} numberOfLines={1}>
                    {getCompanyName(h.symbol)}
                  </Text>
                  <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 1 }}>
                    {absQty.toFixed(4)} @ avg{" "}
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(h.avgCost)}
                  </Text>
                </View>

                {/* Sparkline */}
                <Sparkline prices={h.priceHistory} width={52} height={24} color={isShort ? "#818CF8" : pnlColor} />

                {/* Value + P&L */}
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
                    {isShort
                      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(absQty * h.lastPrice)
                      : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(h.currentValue)
                    }
                  </Text>
                  <View
                    style={{
                      backgroundColor: isUp ? Colors.successBg : Colors.dangerBg,
                      paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
                    }}
                  >
                    <Text style={{ color: pnlColor, fontSize: 11, fontWeight: "700" }}>
                      {isUp ? "+" : ""}
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(h.unrealizedPnl)}{" "}
                      ({isUp ? "+" : ""}{h.unrealizedPnlPct.toFixed(2)}%)
                    </Text>
                  </View>
                </View>
              </View>
              {i < holdings.length - 1 && (
                <View style={{ height: 1, backgroundColor: colors.divider, marginHorizontal: 16 }} />
              )}
            </View>
          );
        })}
      </View>
    </View>
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

// ─── Strategy Lab Section ──────────────────────────────────────────────────────
function StrategyLabSection({
  generations,
  loading,
  expandedRules,
  onToggleRules,
  colors,
}: {
  generations: StrategyGeneration[];
  loading: boolean;
  expandedRules: string | null;
  onToggleRules: (id: string) => void;
  colors: any;
}) {
  const testing = generations.filter((g) => g.status === "testing");
  const graduated = generations.filter((g) => g.status === "graduated");
  const killed = generations.filter((g) => g.status === "killed");
  const latestInsight = generations.filter((g) => g.insight).slice(-1)[0]?.insight ?? null;
  const currentGen = generations.reduce((max, g) => Math.max(max, g.generation_number), 0);

  const STATUS_COLOR: Record<string, string> = {
    testing: Colors.warning,
    graduated: Colors.success,
    killed: Colors.danger,
  };

  const genCard = (g: StrategyGeneration) => {
    const pnlColor = g.total_pnl >= 0 ? Colors.success : Colors.danger;
    const statusColor = STATUS_COLOR[g.status] ?? colors.textSecondary;
    const isExpanded = expandedRules === g.id;

    return (
      <View
        key={g.id}
        style={{
          backgroundColor: colors.card, borderRadius: 14, borderWidth: 1,
          borderColor: g.status === "killed" ? Colors.danger + "30" : g.status === "graduated" ? Colors.success + "30" : colors.cardBorder,
          padding: 14, gap: 10,
          opacity: g.status === "killed" ? 0.6 : 1,
        }}
      >
        {/* Header row */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {g.status === "graduated" ? "Graduated" : g.status === "killed" ? "Killed" : "Testing"}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            · Gen {g.generation_number}
          </Text>
          {g.parent_id && (
            <Text style={{ color: colors.textTertiary, fontSize: 10 }}>↳ variant</Text>
          )}
          <View style={{ flex: 1 }} />
          <Text style={{ color: pnlColor, fontWeight: "700", fontSize: 13 }}>
            {g.total_pnl >= 0 ? "+" : ""}{g.total_pnl.toFixed(2)}
          </Text>
        </View>

        {/* Mutation description */}
        {g.mutation_description && (
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontStyle: "italic" }}>
            {g.mutation_description}
          </Text>
        )}

        {/* Kill reason */}
        {g.kill_reason && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.dangerBg, borderRadius: 8, padding: 8 }}>
            <Ionicons name="close-circle-outline" size={14} color={Colors.danger} />
            <Text style={{ color: Colors.danger, fontSize: 12, flex: 1 }}>{g.kill_reason}</Text>
          </View>
        )}

        {/* Stats */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          {[
            { label: "Trades", value: `${g.total_trades}` },
            { label: "Win %", value: g.total_trades > 0 ? `${g.win_rate.toFixed(1)}%` : "—" },
            { label: "vs SPY", value: g.total_trades > 0 ? `${g.vs_spy_pct >= 0 ? "+" : ""}${g.vs_spy_pct.toFixed(1)}%` : "—" },
          ].map((s) => (
            <View key={s.label} style={{ alignItems: "center", gap: 2 }}>
              <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>{s.value}</Text>
              <Text style={{ color: colors.textTertiary, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* View Rules button */}
        <Pressable
          onPress={() => onToggleRules(g.id)}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
            backgroundColor: colors.cardSecondary, borderWidth: 1, borderColor: colors.cardBorder,
          }}
        >
          <Ionicons name={isExpanded ? "chevron-up" : "document-text-outline"} size={13} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600" }}>
            {isExpanded ? "Hide Rules" : "View Rules"}
          </Text>
        </Pressable>

        {/* Expanded rules */}
        {isExpanded && (
          <View style={{ backgroundColor: colors.cardSecondary, borderRadius: 10, padding: 12 }}>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>{g.strategy_rules}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ gap: 16 }}>
      {/* Lab header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.accentBg, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 18 }}>🧬</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800" }}>Strategy Lab</Text>
          {currentGen > 0 && (
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
              Generation {currentGen} · {graduated.length} graduated · {testing.length} testing
            </Text>
          )}
        </View>
      </View>

      {loading && (
        <View style={{ padding: 20, alignItems: "center" }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      )}

      {!loading && generations.length === 0 && (
        <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, borderStyle: "dashed", padding: 24, alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 32 }}>🧪</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
            The lab is warming up. After the first market close, it will analyze your agents and begin evolving strategies.
          </Text>
        </View>
      )}

      {/* Latest AI Insight */}
      {latestInsight && (
        <View style={{ backgroundColor: Colors.accentBg, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.accent + "30" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="bulb-outline" size={16} color={Colors.accentLight} />
            <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 13 }}>Latest Insight</Text>
          </View>
          <Text style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>{latestInsight}</Text>
        </View>
      )}

      {/* Active test variants */}
      {testing.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: Colors.warning, fontWeight: "700", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Testing ({testing.length})
          </Text>
          {testing.map(genCard)}
        </View>
      )}

      {/* Graduated strategies */}
      {graduated.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: Colors.success, fontWeight: "700", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Graduated ({graduated.length})
          </Text>
          {graduated.map(genCard)}
        </View>
      )}

      {/* Killed variants */}
      {killed.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: Colors.danger, fontWeight: "700", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Killed ({killed.length})
          </Text>
          {killed.map(genCard)}
        </View>
      )}
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
