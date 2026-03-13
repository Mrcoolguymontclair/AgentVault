import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { fetchAgentTrades, fetchPublicAgent, type DbTrade } from "@/lib/services/agentService";
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
import { STRATEGIES, RISK_CONFIG, AI_MODELS } from "@/constants/strategies";
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

  const handleRunNow = useCallback(async () => {
    if (!agent) return;
    setRunLoading(true);
    try {
      // force=true bypasses the market-hours gate so Run Now always executes for testing
      const result = await invokeRunAgents(agent.id, true);

      if (!result.ok) {
        Alert.alert("Run Failed", result.error ?? "Something went wrong. Check your connection and try again.");
        return;
      }

      // Top-level market-closed gate (only when force=false; shouldn't fire via Run Now)
      if (result.marketClosed) {
        Alert.alert(
          "Market Closed",
          "Market is closed. Trades will execute automatically during market hours (9:30 AM – 4:00 PM ET, Mon–Fri)."
        );
        return;
      }

      const r = result.results?.[0];

      if (!r) {
        Alert.alert("No Result", "Agent returned no result. Make sure the agent exists and try again.");
        return;
      }

      if (r.skipped) {
        const reason = r.skipReason ?? "";
        if (reason.toLowerCase().includes("no signal") || reason.toLowerCase().includes("signal generated")) {
          Alert.alert("No Signal Found", "No trade signal found. The strategy saw no actionable opportunity in current market conditions.");
        } else if (reason.toLowerCase().includes("market")) {
          Alert.alert(
            "Market Closed",
            "Market is closed. Trades will execute automatically during market hours (9:30 AM – 4:00 PM ET, Mon–Fri)."
          );
        } else if (reason.toLowerCase().includes("daily loss")) {
          Alert.alert("Risk Limit Reached", `Daily loss limit hit for today. Trading is paused until tomorrow.\n\nDetails: ${r.skipReason}`);
        } else if (reason.toLowerCase().includes("budget fully deployed")) {
          Alert.alert("Budget Deployed", "All available budget is already in open positions. Close a position to free up capital.");
        } else if (reason.toLowerCase().includes("ai rejected") || reason.toLowerCase().includes("confidence")) {
          Alert.alert("AI Skipped Trade", `The AI model decided not to trade.\n\n${r.skipReason}`);
        } else if (reason.toLowerCase().includes("qty") || reason.toLowerCase().includes("size too small")) {
          Alert.alert("Trade Too Small", "The position size rounds to zero at current prices. Increase your budget or adjust parameters.");
        } else {
          Alert.alert("No Trade", r.skipReason ?? "No trade signal found.");
        }
      } else if (r.success) {
        const pnlStr = r.pnl !== undefined && r.pnl !== 0
          ? `\nP&L: ${r.pnl >= 0 ? "+" : ""}$${r.pnl.toFixed(2)}` : "";
        Alert.alert(
          "Trade Executed ✓",
          `${r.side?.toUpperCase()} ${r.qty} ${r.symbol} @ $${r.price?.toFixed(2)}${pnlStr}\n\nAI reasoning: ${r.aiReasoning}`
        );
        fetchAgentTrades(agent.id, 50).then(({ data }) => setTrades(data ?? []));
      } else {
        Alert.alert("Trade Failed", r.error ?? "Execution error. The order may have been rejected by the broker.");
      }
    } catch (err: any) {
      Alert.alert("Unexpected Error", err?.message ?? "Something went wrong running the agent.");
    } finally {
      setRunLoading(false);
    }
  }, [agent]);

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
  const isPositive = agent.pnl >= 0;

  return (
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
            <>
              <Pressable
                onPress={handleRunNow}
                disabled={runLoading}
                style={{
                  height: 38, paddingHorizontal: 12, borderRadius: 12,
                  backgroundColor: Colors.accentBg, borderWidth: 1, borderColor: Colors.accent,
                  alignItems: "center", justifyContent: "center",
                  flexDirection: "row", gap: 5, opacity: runLoading ? 0.6 : 1,
                }}
              >
                {runLoading
                  ? <ActivityIndicator size="small" color={Colors.accentLight} />
                  : <Ionicons name="play-circle" size={15} color={Colors.accentLight} />
                }
                <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 13 }}>
                  {runLoading ? "Running…" : "Run Now"}
                </Text>
              </Pressable>
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
            </>
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
            { label: "Win Rate", value: agent.status === "backtesting" ? "—" : `${agent.winRate}%`, icon: "trophy-outline" },
            { label: "Max DD", value: agent.status === "backtesting" ? "—" : `${agent.maxDrawdown}%`, icon: "trending-down-outline" },
            { label: "Sharpe", value: agent.status === "backtesting" ? "—" : `${agent.sharpeRatio}`, icon: "analytics-outline" },
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

        {/* Backtesting banner */}
        {agent.status === "backtesting" && (
          <View
            style={{
              backgroundColor: Colors.accentBg, borderRadius: 14, padding: 14,
              flexDirection: "row", alignItems: "center", gap: 10,
            }}
          >
            <ActivityIndicator size="small" color={Colors.accentLight} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 14 }}>
                Backtesting in Progress
              </Text>
              <Text style={{ color: Colors.accent, fontSize: 12, marginTop: 2 }}>
                Analyzing historical data — results coming soon.
              </Text>
            </View>
          </View>
        )}

        {/* Own agent — Pause/Resume */}
        {canToggle && (
          <Button
            variant={agent.status === "active" ? "ghost" : "primary"}
            size="md"
            onPress={handleToggle}
            loading={actionLoading}
            icon={
              <Ionicons
                name={agent.status === "active" ? "pause-circle-outline" : "play-circle-outline"}
                size={18}
                color={agent.status === "active" ? colors.text : "#fff"}
              />
            }
          >
            {agent.status === "active" ? "Pause Agent" : "Resume Agent"}
          </Button>
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
              label="Visibility"
              value={agent.isPrivate ? "Private" : "Public"}
              icon={agent.isPrivate ? "eye-off-outline" : "eye-outline"}
              colors={colors}
            />

            {Object.keys(agent.config).length > 0 && (
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
            )}
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
