import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore, type Agent, type AgentStatus } from "@/store/agentStore";
import { Card, PressableCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { CardSkeleton } from "@/components/ui/LoadingSkeleton";
import { formatCurrency, formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";

type FilterStatus = "all" | AgentStatus;

const STATUS_BADGES: Record<AgentStatus, { variant: any; label: string }> = {
  active: { variant: "success", label: "Active" },
  paused: { variant: "warning", label: "Paused" },
  stopped: { variant: "danger", label: "Stopped" },
  backtesting: { variant: "accent", label: "Backtesting" },
};

export default function AgentsScreen() {
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();
  const { agents, toggleAgent, isLoading, loadAgents } = useAgentStore();
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const filtered = filter === "all" ? agents : agents.filter((a) => a.status === filter);

  async function onRefresh() {
    setRefreshing(true);
    if (authUser?.id) await loadAgents(authUser.id);
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
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.8 }}>
            My Agents
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
            {agents.filter((a) => a.status === "active").length} running · {agents.length} total
          </Text>
        </View>
        <Button
          variant="primary"
          size="sm"
          icon={<Ionicons name="add" size={16} color="#fff" />}
          onPress={() => setShowCreateModal(true)}
        >
          New Agent
        </Button>
      </View>

      {/* Filter Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}
      >
        {FILTERS.map((f) => (
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
          </Pressable>
        ))}
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
                ? "You haven't created any agents yet. Build your first AI trading agent in minutes."
                : `No agents with status "${filter}" found.`
            }
            ctaLabel={filter === "all" ? "Create First Agent" : undefined}
            onCta={filter === "all" ? () => setShowCreateModal(true) : undefined}
          />
        ) : (
          filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              colors={colors}
              onPress={() => setSelectedAgent(agent)}
              onToggle={() => toggleAgent(agent.id)}
            />
          ))
        )}
      </ScrollView>

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          colors={colors}
          onToggle={() => {
            toggleAgent(selectedAgent.id);
            setSelectedAgent(null);
          }}
        />
      )}

      {/* Create Agent Modal */}
      <Modal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Agent"
        subtitle="Deploy a new AI trading strategy"
        primaryAction={{ label: "Coming Soon", onPress: () => setShowCreateModal(false) }}
        secondaryAction={{ label: "Cancel", onPress: () => setShowCreateModal(false) }}
        size="md"
      >
        <View style={{ gap: 16 }}>
          <View
            style={{
              backgroundColor: Colors.accentBg,
              borderRadius: 16,
              padding: 16,
              alignItems: "center",
              gap: 8,
            }}
          >
            <Ionicons name="hardware-chip-outline" size={40} color={Colors.accentLight} />
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16, textAlign: "center" }}>
              Agent Builder
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 }}>
              Choose a strategy, configure risk settings, and deploy your agent in minutes.
            </Text>
          </View>
          {["Trend Following", "Mean Reversion", "News-Driven", "Scalping"].map((s) => (
            <Pressable
              key={s}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 14,
                backgroundColor: colors.cardSecondary,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.cardBorder,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "600", fontSize: 15 }}>{s}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          ))}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function AgentCard({
  agent,
  colors,
  onPress,
  onToggle,
}: {
  agent: Agent;
  colors: any;
  onPress: () => void;
  onToggle: () => void;
}) {
  const sb = STATUS_BADGES[agent.status];
  const canToggle = agent.status === "active" || agent.status === "paused";

  return (
    <PressableCard onPress={onPress}>
      {/* Top Row */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
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
          <Ionicons name="hardware-chip-outline" size={24} color={Colors.accentLight} />
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}>
            {agent.name}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            {agent.strategy}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
            <Badge label={sb.label} variant={sb.variant} />
            <Badge label={agent.mode} variant={agent.mode === "live" ? "live" : "paper"} dot />
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

      {/* Divider */}
      <View style={{ height: 1, backgroundColor: colors.divider, marginBottom: 14 }} />

      {/* Stats Row */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
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
      <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </Text>
      <Text
        style={{
          color: negative && value !== "—" ? Colors.danger : colors.text,
          fontWeight: "700",
          fontSize: 15,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function AgentDetailModal({
  agent,
  onClose,
  colors,
  onToggle,
}: {
  agent: Agent;
  onClose: () => void;
  colors: any;
  onToggle: () => void;
}) {
  const canToggle = agent.status === "active" || agent.status === "paused";
  const sb = STATUS_BADGES[agent.status];

  return (
    <Modal
      visible
      onClose={onClose}
      title={agent.name}
      subtitle={agent.strategy}
      size="lg"
      primaryAction={
        canToggle
          ? {
              label: agent.status === "active" ? "Pause Agent" : "Resume Agent",
              onPress: onToggle,
            }
          : undefined
      }
      secondaryAction={{ label: "Close", onPress: onClose }}
    >
      {/* Status + Mode */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Badge label={sb.label} variant={sb.variant} size="md" />
        <Badge
          label={agent.mode === "live" ? "Live Trading" : "Paper Mode"}
          variant={agent.mode === "live" ? "live" : "paper"}
          size="md"
          dot
        />
      </View>

      {/* Description */}
      <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 22 }}>
        {agent.description}
      </Text>

      {/* P&L Card */}
      <View
        style={{
          backgroundColor: agent.pnl >= 0 ? Colors.successBg : Colors.dangerBg,
          borderRadius: 16,
          padding: 16,
          gap: 4,
        }}
      >
        <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600", textTransform: "uppercase" }}>
          Total P&L
        </Text>
        <Text
          style={{
            color: agent.pnl >= 0 ? Colors.success : Colors.danger,
            fontSize: 32,
            fontWeight: "800",
          }}
        >
          {formatCurrency(agent.pnl)}
        </Text>
        <Text style={{ color: agent.pnl >= 0 ? Colors.success : Colors.danger, fontSize: 14, fontWeight: "600" }}>
          {formatPercent(agent.pnlPct)} return
        </Text>
      </View>

      {/* Stats Grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {[
          { label: "Total Trades", value: `${agent.trades}` },
          { label: "Win Rate", value: agent.status === "backtesting" ? "—" : `${agent.winRate}%` },
          { label: "Max Drawdown", value: agent.status === "backtesting" ? "—" : `${agent.maxDrawdown}%` },
          { label: "Sharpe Ratio", value: agent.status === "backtesting" ? "—" : `${agent.sharpeRatio}` },
        ].map((s) => (
          <View
            key={s.label}
            style={{
              flex: 1,
              minWidth: "45%",
              backgroundColor: colors.cardSecondary,
              borderRadius: 12,
              padding: 14,
              gap: 4,
            }}
          >
            <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: "600", textTransform: "uppercase" }}>
              {s.label}
            </Text>
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 20 }}>{s.value}</Text>
          </View>
        ))}
      </View>

      <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: "center" }}>
        Created {agent.createdAt}
      </Text>
    </Modal>
  );
}
