import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { useAgentStore } from "@/store/agentStore";
import { useNotificationStore } from "@/store/notificationStore";
import { useDebugStore } from "@/store/debugStore";
import { Colors } from "@/constants/colors";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { invokeRunAgents } from "@/lib/services/functionService";
import { supabase } from "@/lib/supabase";
import {
  fetchAgentLogs,
  clearAgentLogs,
  resetAgentStats,
  simulateTrade,
  fetchDebugTable,
  testSupabaseConnection,
  fetchGroqStatsToday,
  fetchGroqUsageHistory,
  type AgentLog,
  type GroqStats,
  type GroqHourlyEntry,
} from "@/lib/services/debugService";

const DEBUG_TABLES = ["agents", "trades", "agent_logs", "notifications", "profiles"] as const;
type DebugTable = (typeof DEBUG_TABLES)[number];

const WATCHLIST_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN"];

export default function DebugScreen() {
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();
  const { agents, loadAgents } = useAgentStore();
  const { loadNotifications } = useNotificationStore();
  const { setLastEdgeFunction } = useDebugStore();

  // Logs
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  // API Status
  const [supabaseOk, setSupabaseOk] = useState<boolean | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);

  // Groq Usage
  const [groqStats, setGroqStats] = useState<GroqStats | null>(null);
  const [groqHistory, setGroqHistory] = useState<GroqHourlyEntry[]>([]);
  const [groqLoading, setGroqLoading] = useState(true);

  // Controls loading states
  const [forceRunLoading, setForceRunLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [clearLogsLoading, setClearLogsLoading] = useState(false);
  const [clearNotifsLoading, setClearNotifsLoading] = useState(false);
  const [simLoading, setSimLoading] = useState(false);

  // Simulate trade form
  const [simAgentId, setSimAgentId] = useState("");
  const [simSymbol, setSimSymbol] = useState("AAPL");
  const [simSide, setSimSide] = useState<"buy" | "sell">("buy");
  const [simQty, setSimQty] = useState("1");
  const [simPrice, setSimPrice] = useState("150");
  const [showSimForm, setShowSimForm] = useState(false);

  // Raw data viewer
  const [selectedTable, setSelectedTable] = useState<DebugTable>("agent_logs");
  const [tableData, setTableData] = useState<unknown[]>([]);
  const [tableLoading, setTableLoading] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!authUser?.id) return;
    setLogsLoading(true);
    const data = await fetchAgentLogs(authUser.id, undefined, 50);
    setLogs(data);
    setLogsLoading(false);
  }, [authUser?.id]);

  const checkApiStatus = useCallback(async () => {
    setStatusChecking(true);
    const sbOk = await testSupabaseConnection();
    setSupabaseOk(sbOk);
    setStatusChecking(false);
  }, []);

  const loadGroqStats = useCallback(async () => {
    setGroqLoading(true);
    const [stats, history] = await Promise.all([
      fetchGroqStatsToday(),
      fetchGroqUsageHistory(),
    ]);
    setGroqStats(stats);
    setGroqHistory(history);
    setGroqLoading(false);
  }, []);

  const loadTableData = useCallback(async () => {
    if (!authUser?.id) return;
    setTableLoading(true);
    const data = await fetchDebugTable(authUser.id, selectedTable, 20);
    setTableData(data);
    setTableLoading(false);
  }, [authUser?.id, selectedTable]);

  useEffect(() => {
    loadLogs();
    checkApiStatus();
    loadGroqStats();
  }, []);

  useEffect(() => {
    loadTableData();
  }, [selectedTable]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadLogs(), checkApiStatus(), loadTableData(), loadGroqStats()]);
    setRefreshing(false);
  }, [loadLogs, checkApiStatus, loadTableData, loadGroqStats]);

  async function handleForceRunAll() {
    setForceRunLoading(true);
    try {
      const result = await invokeRunAgents(undefined, true);
      const at = new Date().toISOString();
      setLastEdgeFunction(at, result.ok ?? false);
      const succeeded = result.results?.filter((r) => r.success && !r.skipped).length ?? 0;
      const processed = result.results?.length ?? 0;
      Alert.alert(
        result.ok ? "Run Complete" : "Run Failed",
        result.ok
          ? `Processed ${processed} agents. ${succeeded} trades executed.`
          : result.error ?? "Unknown error"
      );
      await loadLogs();
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Failed to invoke edge function");
    } finally {
      setForceRunLoading(false);
    }
  }

  function handleResetPnl() {
    if (!authUser?.id) return;
    const activeAgents = agents.filter((a) => a.status !== "stopped");
    if (activeAgents.length === 0) {
      Alert.alert("No Agents", "You have no agents to reset.");
      return;
    }
    Alert.alert(
      "Reset Agent Stats",
      "Choose which agent to reset. This deletes all trades and resets P&L to zero. Cannot be undone.",
      [
        ...activeAgents.map((a) => ({
          text: a.name,
          onPress: async () => {
            setResetLoading(true);
            const { error } = await resetAgentStats(a.id, authUser.id);
            setResetLoading(false);
            if (error) Alert.alert("Error", error);
            else {
              Alert.alert("Reset Complete", `${a.name} stats have been reset.`);
              if (authUser?.id) loadAgents(authUser.id);
              loadLogs();
            }
          },
        })),
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  async function handleSimulateTrade() {
    if (!authUser?.id || !simAgentId) {
      Alert.alert("Missing Info", "Select an agent ID first.");
      return;
    }
    const qty = parseFloat(simQty);
    const price = parseFloat(simPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      Alert.alert("Invalid", "Qty and price must be positive numbers.");
      return;
    }
    setSimLoading(true);
    const { error } = await simulateTrade({
      agentId: simAgentId,
      userId: authUser.id,
      symbol: simSymbol,
      side: simSide,
      qty,
      price,
    });
    setSimLoading(false);
    if (error) Alert.alert("Error", error);
    else {
      Alert.alert("Trade Inserted", `Simulated ${simSide.toUpperCase()} ${qty} ${simSymbol} @ $${price}`);
      setShowSimForm(false);
      loadLogs();
    }
  }

  async function handleClearLogs() {
    if (!authUser?.id) return;
    Alert.alert("Clear Logs", "Delete all agent execution logs?", [
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          setClearLogsLoading(true);
          const { error } = await clearAgentLogs(authUser.id);
          setClearLogsLoading(false);
          if (error) Alert.alert("Error", error);
          else setLogs([]);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function handleClearNotifications() {
    if (!authUser?.id) return;
    Alert.alert("Clear Notifications", "Delete all notifications?", [
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          setClearNotifsLoading(true);
          await supabase.from("notifications").delete().eq("user_id", authUser.id);
          if (authUser?.id) await loadNotifications(authUser.id);
          setClearNotifsLoading(false);
          Alert.alert("Done", "Notifications cleared.");
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const sectionTitle = (title: string, extra?: React.ReactNode) => (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>{title}</Text>
      {extra}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.warningBg, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="construct" size={18} color={Colors.warning} />
            </View>
            <View>
              <Text style={{ color: colors.text, fontSize: 22, fontWeight: "800", letterSpacing: -0.6 }}>
                Developer Debug
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 1 }}>
                Internal tools · Not for production
              </Text>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 20 }}>

          {/* ── API STATUS ──────────────────────────────────────── */}
          <View>
            {sectionTitle(
              "API Status",
              <Pressable
                onPress={checkApiStatus}
                hitSlop={8}
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                {statusChecking
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Ionicons name="refresh-outline" size={16} color={Colors.accent} />
                }
                <Text style={{ color: Colors.accent, fontSize: 13, fontWeight: "600" }}>Refresh</Text>
              </Pressable>
            )}
            <Card>
              {[
                {
                  name: "Supabase",
                  icon: "server-outline" as const,
                  status: supabaseOk === null ? "checking" : supabaseOk ? "connected" : "error",
                  detail: supabaseOk === null ? "Checking..." : supabaseOk ? "Connected" : "Connection failed",
                },
                {
                  name: "Alpaca Markets",
                  icon: "trending-up-outline" as const,
                  status: "connected" as const,
                  detail: "Server-side paper keys (Supabase secrets)",
                },
                {
                  name: "Groq AI",
                  icon: "flash-outline" as const,
                  status: "connected" as const,
                  detail: "API key configured via Supabase secrets",
                },
                {
                  name: "Edge Function",
                  icon: "code-slash-outline" as const,
                  status: "connected" as const,
                  detail: "run-agents (deployed)",
                },
              ].map((item, i) => {
                const isOk = item.status === "connected";
                const isWarn = item.status === "warning";
                const isErr = item.status === "error";
                const dotColor = isOk ? Colors.success : isWarn ? Colors.warning : isErr ? Colors.danger : colors.textTertiary;
                return (
                  <View key={item.name}>
                    {i > 0 && <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 10 }} />}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.cardSecondary, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name={item.icon} size={18} color={colors.textSecondary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>{item.name}</Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{item.detail}</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
                        <Text style={{ color: dotColor, fontSize: 12, fontWeight: "600" }}>
                          {item.status === "checking" ? "…" : isOk ? "OK" : isWarn ? "Warn" : "Err"}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>

          {/* ── GROQ USAGE DASHBOARD ─────────────────────────────── */}
          <View>
            {sectionTitle(
              "Groq API Usage",
              <Pressable onPress={loadGroqStats} hitSlop={8}>
                {groqLoading
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Ionicons name="refresh-outline" size={18} color={Colors.accent} />
                }
              </Pressable>
            )}
            {groqLoading && !groqStats ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <ActivityIndicator color={Colors.accent} />
              </View>
            ) : !groqStats ? (
              <Card>
                <Text style={{ color: colors.textTertiary, fontSize: 13 }}>
                  No usage data yet. Agents haven't run today.
                </Text>
              </Card>
            ) : (
              <View style={{ gap: 12 }}>
                {/* Main stats card */}
                <Card>
                  {/* Token progress bar */}
                  <View style={{ gap: 8, marginBottom: 14 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>Today's Tokens</Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        {groqStats.tokens_used.toLocaleString()} / 450,000
                      </Text>
                    </View>
                    <View style={{ height: 8, backgroundColor: colors.cardSecondary, borderRadius: 4, overflow: "hidden" }}>
                      <View
                        style={{
                          height: 8,
                          width: `${Math.min(100, (groqStats.tokens_used / 450_000) * 100)}%` as any,
                          backgroundColor:
                            groqStats.tokens_used >= 400_000 ? Colors.danger :
                            groqStats.tokens_used >= 250_000 ? Colors.warning :
                            Colors.success,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                    <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                      {groqStats.tokens_used >= 400_000
                        ? "Conservative mode ACTIVE — AI confirmation skipped"
                        : `~${Math.max(0, Math.floor((450_000 - groqStats.tokens_used) / 300))} agent runs remaining today`}
                    </Text>
                  </View>

                  {/* Stat rows */}
                  {[
                    { label: "Requests Today",       value: groqStats.request_count.toLocaleString() },
                    { label: "Primary Key Requests", value: groqStats.primary_requests.toLocaleString() },
                    { label: "Backup Key Requests",  value: groqStats.backup_requests > 0 ? groqStats.backup_requests.toLocaleString() : "None" },
                    { label: "Est. Runs Remaining",  value: `~${Math.max(0, Math.floor((450_000 - groqStats.tokens_used) / 300))}` },
                    { label: "Conservative Mode",    value: groqStats.tokens_used >= 400_000 ? "ACTIVE" : "Off",
                      valueColor: groqStats.tokens_used >= 400_000 ? Colors.danger : Colors.success },
                  ].map((row, i) => (
                    <View key={row.label}>
                      <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 8 }} />
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{row.label}</Text>
                        <Text style={{ color: (row as any).valueColor ?? colors.text, fontSize: 13, fontWeight: "700" }}>
                          {row.value}
                        </Text>
                      </View>
                    </View>
                  ))}
                </Card>

                {/* Hourly history */}
                {groqHistory.length > 0 && (
                  <Card>
                    <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13, marginBottom: 12 }}>
                      Hourly Usage (last 24 h · ET)
                    </Text>
                    {groqHistory.map((h, i) => {
                      const barPct = Math.min(100, (h.tokens_used / 14_400) * 100);
                      return (
                        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <Text style={{ color: colors.textTertiary, fontSize: 11, width: 38 }}>{h.hour_start}</Text>
                          <View style={{ flex: 1, height: 6, backgroundColor: colors.cardSecondary, borderRadius: 3, overflow: "hidden" }}>
                            <View style={{ height: 6, width: `${barPct}%` as any, backgroundColor: Colors.accent, borderRadius: 3 }} />
                          </View>
                          <Text style={{ color: colors.textSecondary, fontSize: 11, width: 52, textAlign: "right" }}>
                            {h.tokens_used.toLocaleString()}
                          </Text>
                        </View>
                      );
                    })}
                  </Card>
                )}
              </View>
            )}
          </View>

          {/* ── MANUAL CONTROLS ─────────────────────────────────── */}
          <View>
            {sectionTitle("Manual Controls")}
            <View style={{ gap: 10 }}>
              {/* Force Run */}
              <ControlButton
                icon="play-circle-outline"
                label="Force Run All Agents"
                sublabel="Bypasses market hours · runs edge function now"
                color={Colors.success}
                colorBg={Colors.successBg}
                loading={forceRunLoading}
                onPress={handleForceRunAll}
                colors={colors}
              />

              {/* Reset P&L */}
              <ControlButton
                icon="refresh-circle-outline"
                label="Reset Agent P&L"
                sublabel="Deletes trades & resets stats to zero"
                color={Colors.warning}
                colorBg={Colors.warningBg}
                loading={resetLoading}
                onPress={handleResetPnl}
                colors={colors}
              />

              {/* Simulate Trade */}
              <ControlButton
                icon="swap-horizontal-outline"
                label="Simulate Trade"
                sublabel="Insert a fake trade for testing"
                color={Colors.accent}
                colorBg={Colors.accentBg}
                loading={false}
                onPress={() => setShowSimForm((v) => !v)}
                colors={colors}
                trailingIcon={showSimForm ? "chevron-up" : "chevron-down"}
              />
              {showSimForm && (
                <View
                  style={{
                    backgroundColor: colors.cardSecondary,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    padding: 14,
                    gap: 12,
                  }}
                >
                  {/* Agent picker */}
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600" }}>Agent</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        {agents.slice(0, 6).map((a) => (
                          <Pressable
                            key={a.id}
                            onPress={() => setSimAgentId(a.id)}
                            style={{
                              paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                              backgroundColor: simAgentId === a.id ? Colors.accentBg : colors.card,
                              borderWidth: 1,
                              borderColor: simAgentId === a.id ? Colors.accent : colors.cardBorder,
                            }}
                          >
                            <Text style={{ color: simAgentId === a.id ? Colors.accentLight : colors.textSecondary, fontSize: 12, fontWeight: "600" }}>
                              {a.name}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>

                  {/* Symbol */}
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600" }}>Symbol</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        {WATCHLIST_SYMBOLS.slice(0, 5).map((s) => (
                          <Pressable
                            key={s}
                            onPress={() => setSimSymbol(s)}
                            style={{
                              paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6,
                              backgroundColor: simSymbol === s ? Colors.accentBg : colors.card,
                              borderWidth: 1, borderColor: simSymbol === s ? Colors.accent : colors.cardBorder,
                            }}
                          >
                            <Text style={{ color: simSymbol === s ? Colors.accentLight : colors.textSecondary, fontSize: 11, fontWeight: "600" }}>{s}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>

                  {/* Side */}
                  <View style={{ gap: 6 }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600" }}>Side</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["buy", "sell"] as const).map((s) => (
                        <Pressable
                          key={s}
                          onPress={() => setSimSide(s)}
                          style={{
                            flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center",
                            backgroundColor: simSide === s ? (s === "buy" ? Colors.successBg : Colors.dangerBg) : colors.card,
                            borderWidth: 1,
                            borderColor: simSide === s ? (s === "buy" ? Colors.success : Colors.danger) : colors.cardBorder,
                          }}
                        >
                          <Text style={{ color: simSide === s ? (s === "buy" ? Colors.success : Colors.danger) : colors.textSecondary, fontWeight: "700", fontSize: 13, textTransform: "uppercase" }}>
                            {s}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {/* Qty + Price */}
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {[
                      { label: "Qty", value: simQty, setter: setSimQty, placeholder: "1" },
                      { label: "Price ($)", value: simPrice, setter: setSimPrice, placeholder: "150.00" },
                    ].map((f) => (
                      <View key={f.label} style={{ flex: 1, gap: 6 }}>
                        <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600" }}>{f.label}</Text>
                        <TextInput
                          value={f.value}
                          onChangeText={f.setter}
                          placeholder={f.placeholder}
                          placeholderTextColor={colors.textTertiary}
                          keyboardType="decimal-pad"
                          style={{
                            color: colors.text,
                            backgroundColor: colors.card,
                            borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder,
                            paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
                          }}
                        />
                      </View>
                    ))}
                  </View>

                  <Button
                    variant="primary"
                    size="sm"
                    onPress={handleSimulateTrade}
                    loading={simLoading}
                    disabled={!simAgentId}
                  >
                    Insert Simulated Trade
                  </Button>
                </View>
              )}

              {/* Clear Logs */}
              <ControlButton
                icon="trash-outline"
                label="Clear Agent Logs"
                sublabel="Delete all execution log entries"
                color={Colors.danger}
                colorBg={Colors.dangerBg}
                loading={clearLogsLoading}
                onPress={handleClearLogs}
                colors={colors}
              />

              {/* Clear Notifications */}
              <ControlButton
                icon="notifications-off-outline"
                label="Clear Notifications"
                sublabel="Delete all in-app notifications"
                color={colors.textSecondary}
                colorBg={colors.cardSecondary}
                loading={clearNotifsLoading}
                onPress={handleClearNotifications}
                colors={colors}
              />
            </View>
          </View>

          {/* ── AGENT LOGS ───────────────────────────────────────── */}
          <View>
            {sectionTitle(
              "Agent Logs",
              <Pressable onPress={loadLogs} hitSlop={8}>
                <Ionicons name="refresh-outline" size={18} color={Colors.accent} />
              </Pressable>
            )}
            {logsLoading ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <ActivityIndicator color={Colors.accent} />
              </View>
            ) : logs.length === 0 ? (
              <Card>
                <View style={{ alignItems: "center", gap: 8, paddingVertical: 12 }}>
                  <Ionicons name="document-text-outline" size={36} color={colors.textTertiary} />
                  <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                    No execution logs yet. Logs appear after agents run.
                  </Text>
                </View>
              </Card>
            ) : (
              <View style={{ gap: 8 }}>
                {logs.slice(0, 20).map((log) => (
                  <LogEntry key={log.id} log={log} colors={colors} />
                ))}
                {logs.length > 20 && (
                  <Text style={{ color: colors.textTertiary, fontSize: 12, textAlign: "center" }}>
                    Showing 20 of {logs.length} logs
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* ── RAW DATA VIEWER ──────────────────────────────────── */}
          <View>
            {sectionTitle("Raw Data Viewer")}

            {/* Table picker */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {DEBUG_TABLES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setSelectedTable(t)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                      backgroundColor: selectedTable === t ? Colors.accentBg : colors.card,
                      borderWidth: 1.5,
                      borderColor: selectedTable === t ? Colors.accent : colors.cardBorder,
                    }}
                  >
                    <Text style={{ color: selectedTable === t ? Colors.accentLight : colors.textSecondary, fontWeight: "600", fontSize: 13 }}>
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Pressable
              onPress={loadTableData}
              style={{
                flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                backgroundColor: colors.cardSecondary, borderWidth: 1, borderColor: colors.cardBorder,
                marginBottom: 10,
              }}
            >
              {tableLoading
                ? <ActivityIndicator size="small" color={Colors.accent} />
                : <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
              }
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "600" }}>
                {tableLoading ? "Loading..." : `Fetch ${selectedTable}`}
              </Text>
            </Pressable>

            <View
              style={{
                backgroundColor: colors.cardSecondary,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                padding: 12,
                minHeight: 100,
              }}
            >
              {tableLoading ? (
                <ActivityIndicator color={Colors.accent} />
              ) : tableData.length === 0 ? (
                <Text style={{ color: colors.textTertiary, fontSize: 13 }}>No data · tap Fetch to load</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator>
                  <Text
                    style={{
                      color: colors.textSecondary,
                      fontSize: 11,
                      fontFamily: "monospace",
                      lineHeight: 17,
                    }}
                    selectable
                  >
                    {JSON.stringify(tableData, null, 2)}
                  </Text>
                </ScrollView>
              )}
            </View>
            <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 6 }}>
              Showing up to 20 rows · read-only · your data only
            </Text>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function ControlButton({
  icon, label, sublabel, color, colorBg, loading, onPress, colors, trailingIcon,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel: string;
  color: string;
  colorBg: string;
  loading: boolean;
  onPress: () => void;
  colors: any;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderRadius: 14,
        backgroundColor: pressed ? colors.cardSecondary : colors.card,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        opacity: loading ? 0.6 : 1,
      })}
    >
      <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: colorBg, alignItems: "center", justifyContent: "center" }}>
        {loading
          ? <ActivityIndicator size="small" color={color} />
          : <Ionicons name={icon} size={20} color={color} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: "600", fontSize: 14 }}>{label}</Text>
        <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 2 }}>{sublabel}</Text>
      </View>
      <Ionicons name={trailingIcon ?? "chevron-forward"} size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

function LogEntry({ log, colors }: { log: AgentLog; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const isTraded = log.action === "traded";
  const isError = log.action === "error";
  const actionColor = isTraded ? Colors.success : isError ? Colors.danger : colors.textTertiary;
  const actionBg = isTraded ? Colors.successBg : isError ? Colors.dangerBg : colors.cardSecondary;
  const date = new Date(log.timestamp);
  const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={{
        backgroundColor: colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: isTraded ? Colors.success + "30" : isError ? Colors.danger + "30" : colors.cardBorder,
        padding: 12,
        gap: 8,
      }}
    >
      {/* Row 1: agent name + action + time */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
            {log.agent_name}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            {log.strategy} · {dateStr} {timeStr}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <View style={{ backgroundColor: actionBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
            <Text style={{ color: actionColor, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
              {isTraded ? `${log.signal_side?.toUpperCase()} ${log.trade_symbol}` : log.action}
            </Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.textTertiary} />
        </View>
      </View>

      {/* Expanded details */}
      {expanded && (
        <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8 }}>
          {log.signal_detected && (
            <DetailRow label="Signal" value={`${log.signal_side?.toUpperCase()} ${log.signal_symbol}`} colors={colors} />
          )}
          {log.ai_confidence !== undefined && (
            <DetailRow label="AI Confidence" value={`${((log.ai_confidence ?? 0) * 100).toFixed(0)}%`} colors={colors} />
          )}
          {log.ai_reasoning && (
            <View style={{ gap: 2 }}>
              <Text style={{ color: colors.textTertiary, fontSize: 11, fontWeight: "600", textTransform: "uppercase" }}>AI Reasoning</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17 }}>{log.ai_reasoning}</Text>
            </View>
          )}
          {log.skip_reason && (
            <DetailRow label="Skip Reason" value={log.skip_reason} colors={colors} />
          )}
          {isTraded && (
            <>
              <DetailRow label="Symbol" value={log.trade_symbol ?? "—"} colors={colors} />
              <DetailRow label="Qty" value={String(log.trade_qty ?? "—")} colors={colors} />
              <DetailRow label="Price" value={log.trade_price ? `$${Number(log.trade_price).toFixed(2)}` : "—"} colors={colors} />
              <DetailRow
                label="P&L"
                value={log.trade_pnl !== undefined && log.trade_pnl !== null
                  ? `${Number(log.trade_pnl) >= 0 ? "+" : ""}$${Number(log.trade_pnl).toFixed(2)}`
                  : "—"
                }
                colors={colors}
                valueColor={Number(log.trade_pnl ?? 0) >= 0 ? Colors.success : Colors.danger}
              />
            </>
          )}
        </View>
      )}
    </Pressable>
  );
}

function DetailRow({ label, value, colors, valueColor }: { label: string; value: string; colors: any; valueColor?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
      <Text style={{ color: colors.textTertiary, fontSize: 12, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: valueColor ?? colors.text, fontSize: 12, fontWeight: "600", flex: 1, textAlign: "right", paddingLeft: 12 }} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}
