import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  ToastAndroid,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAgentStore } from "@/store/agentStore";
import { fetchAgentTrades, type DbTrade } from "@/lib/services/agentService";
import { invokeRunAgents } from "@/lib/services/functionService";
import { formatCurrency, formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { STRATEGIES, RISK_CONFIG, AI_MODELS } from "@/constants/strategies";
import type { StrategyId, ModelId } from "@/constants/strategies";

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
  const { agents, toggleAgent, deleteAgent } = useAgentStore();
  const [trades, setTrades] = useState<DbTrade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);

  const agent = agents.find((a) => a.id === id);

  useEffect(() => {
    if (!id) return;
    fetchAgentTrades(id, 50).then(({ data }) => {
      setTrades(data ?? []);
      setTradesLoading(false);
    });
  }, [id]);

  const handleToggle = useCallback(async () => {
    if (!agent) return;
    setActionLoading(true);
    await toggleAgent(agent.id);
    setActionLoading(false);
  }, [agent, toggleAgent]);

  const handleRunNow = useCallback(async () => {
    if (!agent) return;
    setRunLoading(true);
    const result = await invokeRunAgents(agent.id, true);
    setRunLoading(false);

    if (!result.ok) {
      Alert.alert("Run Failed", result.error ?? "Something went wrong.");
      return;
    }

    const r = result.results?.[0];
    if (!r) {
      Alert.alert("No Result", "Agent ran but returned no result.");
      return;
    }

    if (r.skipped) {
      const msg = r.skipReason ?? "No signal generated.";
      Alert.alert("No Trade", msg);
    } else if (r.success) {
      const pnlStr = r.pnl !== undefined && r.pnl !== 0
        ? ` · P&L: ${r.pnl >= 0 ? "+" : ""}$${r.pnl.toFixed(2)}`
        : "";
      Alert.alert(
        "Trade Executed",
        `${r.side?.toUpperCase()} ${r.qty} ${r.symbol} @ $${r.price?.toFixed(2)}${pnlStr}\n\nAI: ${r.aiReasoning}`
      );
      // Reload trades to show the new one
      fetchAgentTrades(agent.id, 50).then(({ data }) => setTrades(data ?? []));
    } else {
      Alert.alert("Trade Failed", r.error ?? "Execution error.");
    }
  }, [agent]);

  const handleDelete = useCallback(() => {
    if (!agent) return;
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
            if (error) {
              Alert.alert("Error", "Failed to delete agent. Please try again.");
            } else {
              router.back();
            }
          },
        },
      ]
    );
  }, [agent, deleteAgent, router]);

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
  const canToggle = agent.status === "active" || agent.status === "paused";
  const strategyDef = STRATEGIES.find((s) => s.id === (agent.strategy as StrategyId));
  const modelDef = AI_MODELS.find((m) => m.id === (agent.modelId as ModelId));
  const riskConfig = strategyDef ? RISK_CONFIG[strategyDef.risk] : null;
  const totalPnL = agent.pnl;
  const isPositive = totalPnL >= 0;

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
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            alignItems: "center",
            justifyContent: "center",
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
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 1 }}>
            {strategyDef?.name ?? agent.strategy}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={handleRunNow}
            disabled={runLoading}
            hitSlop={8}
            style={{
              height: 38,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: Colors.accentBg,
              borderWidth: 1,
              borderColor: Colors.accent,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 6,
              opacity: runLoading ? 0.6 : 1,
            }}
          >
            {runLoading
              ? <ActivityIndicator size="small" color={Colors.accentLight} />
              : <Ionicons name="play-circle" size={16} color={Colors.accentLight} />
            }
            <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 13 }}>
              {runLoading ? "Running…" : "Run Now"}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleDelete}
            hitSlop={12}
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: Colors.dangerBg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="trash-outline" size={18} color={Colors.danger} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 16, paddingBottom: 32 }}
      >
        {/* Hero P&L Card */}
        <View
          style={{
            backgroundColor: isPositive ? Colors.successBg : Colors.dangerBg,
            borderRadius: 20,
            padding: 20,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 28 }}>{strategyDef?.icon ?? "🤖"}</Text>
            <Badge label={sb.label} variant={sb.variant} size="md" />
            <Badge
              label={agent.mode === "live" ? "Live" : "Paper"}
              variant={agent.mode === "live" ? "live" : "paper"}
              size="md"
              dot
            />
          </View>
          <Text
            style={{
              color: isPositive ? Colors.success : Colors.danger,
              fontSize: 40,
              fontWeight: "900",
              letterSpacing: -1,
            }}
          >
            {formatCurrency(totalPnL, true)}
          </Text>
          <Text
            style={{
              color: isPositive ? Colors.success : Colors.danger,
              fontSize: 16,
              fontWeight: "600",
            }}
          >
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
                flex: 1,
                backgroundColor: colors.card,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                padding: 12,
                alignItems: "center",
                gap: 4,
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

        {/* Backtesting Banner */}
        {agent.status === "backtesting" && (
          <View
            style={{
              backgroundColor: Colors.accentBg,
              borderRadius: 14,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <ActivityIndicator size="small" color={Colors.accentLight} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 14 }}>
                Backtesting in Progress
              </Text>
              <Text style={{ color: Colors.accent, fontSize: 12, marginTop: 2 }}>
                Your agent is analyzing historical data. Results will be ready soon.
              </Text>
            </View>
          </View>
        )}

        {/* Actions */}
        {canToggle && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
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
            </View>
          </View>
        )}

        {/* Configuration */}
        {strategyDef && (
          <Card>
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: 11,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                marginBottom: 12,
              }}
            >
              Configuration
            </Text>
            {/* Strategy */}
            <InfoRow label="Strategy" value={strategyDef.name} icon="layers-outline" colors={colors} />
            {riskConfig && (
              <InfoRow label="Risk Level" value={riskConfig.label} icon="shield-outline" colors={colors} />
            )}
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

            {/* Params */}
            {Object.keys(agent.config).length > 0 && (
              <>
                <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 12 }} />
                <Text
                  style={{
                    color: colors.textTertiary,
                    fontSize: 11,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 10,
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
                  No trades yet. Trades will appear here once your agent starts trading.
                </Text>
              </View>
            </Card>
          ) : (
            trades.map((trade) => <TradeRow key={trade.id} trade={trade} colors={colors} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value,
  icon,
  colors,
}: {
  label: string;
  value: string;
  icon?: string;
  colors: any;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
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
        backgroundColor: colors.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: isBuy ? Colors.successBg : Colors.dangerBg,
          alignItems: "center",
          justifyContent: "center",
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
            fontWeight: "700",
            fontSize: 14,
          }}
        >
          {pnl === 0 ? "—" : formatCurrency(pnl, true)}
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: 11 }}>P&L</Text>
      </View>
    </View>
  );
}
