import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore, type Agent, type AgentStatus } from "@/store/agentStore";
import { Card, PressableCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/LoadingSkeleton";
import { Sparkline } from "@/components/ui/Sparkline";
import { DeploySheet } from "@/components/agents/DeploySheet";
import { formatCurrency, formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";
import { STRATEGIES, RISK_CONFIG } from "@/constants/strategies";
import type { StrategyId } from "@/constants/strategies";
import { fetchAgentPnlHistories } from "@/lib/services/portfolioService";

type FilterStatus = "all" | AgentStatus;

const STATUS_BADGES: Record<AgentStatus, { variant: any; label: string }> = {
  active: { variant: "success", label: "Active" },
  paused: { variant: "warning", label: "Paused" },
  stopped: { variant: "danger", label: "Stopped" },
  backtesting: { variant: "accent", label: "Backtesting" },
};

export default function AgentsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();
  const { agents, toggleAgent, isLoading, loadAgents } = useAgentStore();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const [pnlHistories, setPnlHistories] = useState<Record<string, number[]>>({});

  const filtered = filter === "all" ? agents : agents.filter((a) => a.status === filter);
  const activeCount = agents.filter((a) => a.status === "active").length;

  const loadSparklines = useCallback(async () => {
    if (agents.length === 0) return;
    const histories = await fetchAgentPnlHistories(agents.map((a) => a.id), 30);
    setPnlHistories(histories);
  }, [agents]);

  useEffect(() => { loadSparklines(); }, [loadSparklines]);

  async function onRefresh() {
    setRefreshing(true);
    if (authUser?.id) await loadAgents(authUser.id);
    await loadSparklines();
    setRefreshing(false);
  }

  const FILTERS: { label: string; value: FilterStatus }[] = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },
    { label: "Paused", value: "paused" },
    { label: "Backtesting", value: "backtesting" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 16,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text
            style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.8 }}
          >
            My Agents
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
            {activeCount} running · {agents.length} total
          </Text>
        </View>
        <Button
          variant="primary"
          size="sm"
          icon={<Ionicons name="add" size={16} color="#fff" />}
          onPress={() => setShowDeploy(true)}
        >
          Deploy
        </Button>
      </View>

      {/* Filter Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12, alignItems: "center" }}
      >
        {FILTERS.map((f) => {
          const count =
            f.value === "all"
              ? agents.length
              : agents.filter((a) => a.status === f.value).length;
          return (
            <Pressable
              key={f.value}
              onPress={() => setFilter(f.value)}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 100,
                backgroundColor: filter === f.value ? Colors.accent : colors.card,
                borderWidth: 1,
                borderColor: filter === f.value ? Colors.accent : colors.cardBorder,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Text
                style={{
                  color: filter === f.value ? "#FFFFFF" : colors.textSecondary,
                  fontWeight: "600",
                  fontSize: 13,
                }}
              >
                {f.label}
              </Text>
              {count > 0 && (
                <View
                  style={{
                    backgroundColor: filter === f.value ? "rgba(255,255,255,0.25)" : colors.cardBorder,
                    borderRadius: 100,
                    minWidth: 18,
                    height: 18,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 5,
                  }}
                >
                  <Text
                    style={{
                      color: filter === f.value ? "#fff" : colors.textSecondary,
                      fontSize: 11,
                      fontWeight: "700",
                    }}
                  >
                    {count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Agent List */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12, paddingBottom: 24 }}
      >
        {isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="hardware-chip-outline"
            title="No Agents Found"
            description={
              filter === "all"
                ? "You haven't deployed any agents yet. Choose a strategy and launch your first AI trading agent."
                : `No agents with status "${filter}" found.`
            }
            ctaLabel={filter === "all" ? "Deploy First Agent" : undefined}
            onCta={filter === "all" ? () => setShowDeploy(true) : undefined}
          />
        ) : (
          filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              colors={colors}
              pnlHistory={pnlHistories[agent.id] ?? []}
              onPress={() => router.push(`/agent/${agent.id}` as any)}
              onToggle={() => toggleAgent(agent.id)}
            />
          ))
        )}
      </ScrollView>

      {/* Deploy Sheet */}
      <DeploySheet
        visible={showDeploy}
        onClose={() => setShowDeploy(false)}
        onDeployed={() => {
          setShowDeploy(false);
          if (authUser?.id) loadAgents(authUser.id);
        }}
      />
    </SafeAreaView>
  );
}

function AgentCard({
  agent,
  colors,
  pnlHistory,
  onPress,
  onToggle,
}: {
  agent: Agent;
  colors: any;
  pnlHistory: number[];
  onPress: () => void;
  onToggle: () => void;
}) {
  const sb = STATUS_BADGES[agent.status];
  const canToggle = agent.status === "active" || agent.status === "paused";
  const strategyDef = STRATEGIES.find((s) => s.id === (agent.strategy as StrategyId));
  const riskConfig = strategyDef ? RISK_CONFIG[strategyDef.risk] : null;

  return (
    <PressableCard onPress={onPress}>
      {/* Top Row */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <View
          style={{
            width: 50,
            height: 50,
            borderRadius: 15,
            backgroundColor: colors.cardSecondary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 26 }}>{strategyDef?.icon ?? "🤖"}</Text>
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}>
            {agent.name}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            {strategyDef?.name ?? agent.strategy}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
            <Badge label={sb.label} variant={sb.variant} />
            <Badge label={agent.mode === "live" ? "Live" : "Paper"} variant={agent.mode === "live" ? "live" : "paper"} dot />
            {riskConfig && (
              <Badge
                label={riskConfig.label}
                variant={strategyDef?.risk === "low" ? "success" : strategyDef?.risk === "medium" ? "warning" : "danger"}
              />
            )}
          </View>
        </View>

        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text
            style={{
              color: agent.pnl >= 0 ? Colors.success : Colors.danger,
              fontWeight: "800",
              fontSize: 18,
            }}
          >
            {formatCurrency(agent.pnl, true)}
          </Text>
          <Text
            style={{
              color: agent.pnl >= 0 ? Colors.success : Colors.danger,
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {formatPercent(agent.pnlPct)}
          </Text>
        </View>
      </View>

      {/* Divider + Sparkline */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
        {pnlHistory.length >= 2 && (
          <Sparkline
            prices={pnlHistory}
            width={80}
            height={28}
            color={agent.pnl >= 0 ? Colors.success : Colors.danger}
            strokeWidth={1.5}
          />
        )}
      </View>

      {/* Stats Row */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <StatMini label="Budget" value={formatCurrency(agent.budget)} colors={colors} />
        <StatMini label="Trades" value={`${agent.trades}`} colors={colors} />
        <StatMini
          label="Win Rate"
          value={agent.status === "backtesting" ? "—" : `${agent.winRate}%`}
          colors={colors}
        />
        <StatMini
          label="Max DD"
          value={agent.status === "backtesting" ? "—" : `${agent.maxDrawdown}%`}
          negative
          colors={colors}
        />

        {canToggle && (
          <Pressable onPress={onToggle} hitSlop={10}>
            <Switch
              value={agent.status === "active"}
              onValueChange={onToggle}
              trackColor={{ false: colors.cardBorder, true: Colors.accentBg }}
              thumbColor={agent.status === "active" ? Colors.accent : colors.textTertiary}
              ios_backgroundColor={colors.cardBorder}
            />
          </Pressable>
        )}
      </View>

      {agent.status === "backtesting" && (
        <View
          style={{
            marginTop: 12,
            backgroundColor: Colors.accentBg,
            borderRadius: 10,
            padding: 10,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons name="time-outline" size={15} color={Colors.accentLight} />
          <Text style={{ color: Colors.accentLight, fontSize: 12, fontWeight: "600" }}>
            Backtesting in progress — results soon
          </Text>
        </View>
      )}

      {/* View Detail Hint */}
      <View
        style={{
          marginTop: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 4,
        }}
      >
        <Text style={{ color: colors.textTertiary, fontSize: 12 }}>View details</Text>
        <Ionicons name="chevron-forward" size={13} color={colors.textTertiary} />
      </View>
    </PressableCard>
  );
}

function StatMini({
  label,
  value,
  negative,
  colors,
}: {
  label: string;
  value: string;
  negative?: boolean;
  colors: any;
}) {
  return (
    <View style={{ alignItems: "center", gap: 3 }}>
      <Text
        style={{
          color: colors.textTertiary,
          fontSize: 10,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: negative && value !== "—" ? Colors.danger : colors.text,
          fontWeight: "700",
          fontSize: 14,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
