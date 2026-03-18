/**
 * /status?key=agentvault2026
 *
 * Public daily trading summary — no login required.
 * Auto-refreshes every 60 seconds. Shows market status, today's trades,
 * P&L, per-agent breakdown, and execution logs.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";

// ─── Access gate ──────────────────────────────────────────────────────────────
const STATUS_KEY = "agentvault2026";
const AUTO_REFRESH_MS = 60_000;

// ─── Hardcoded dark theme (no ThemeProvider dependency) ──────────────────────
const C = {
  bg:           "#080808",
  card:         "#111111",
  cardBorder:   "#1E1E1E",
  divider:      "#1A1A1A",
  text:         "#FFFFFF",
  textSub:      "#888888",
  textTertiary: "#444444",
  green:        "#00C805",
  greenBg:      "rgba(0,200,5,0.10)",
  red:          "#FF3B30",
  redBg:        "rgba(255,59,48,0.10)",
  yellow:       "#FF9500",
  yellowBg:     "rgba(255,149,0,0.10)",
  accent:       "#22C55E",
  accentBg:     "rgba(34,197,94,0.10)",
  blue:         "#3B82F6",
  blueBg:       "rgba(59,130,246,0.10)",
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Summary {
  today_date:     string;
  total_trades:   number;
  total_pnl:      number;
  winning_trades: number;
  losing_trades:  number;
  win_rate:       number;
  best_symbol:    string | null;
  best_pnl:       number | null;
  worst_symbol:   string | null;
  worst_pnl:      number | null;
}

interface AgentRow {
  agent_id:       string;
  agent_name:     string;
  strategy:       string;
  status:         string;
  mode:           string;
  trades_today:   number;
  pnl_today:      number;
  wins_today:     number;
  win_rate_today: number;
  last_signal_at: string | null;
}

interface LogRow {
  log_id:          string;
  ts:              string;
  agent_name:      string;
  strategy:        string;
  action:          string;
  signal_detected: boolean;
  signal_symbol:   string | null;
  signal_side:     string | null;
  skip_reason:     string | null;
  trade_symbol:    string | null;
  trade_qty:       number | null;
  trade_price:     number | null;
  trade_pnl:       number | null;
  ai_confidence:   number | null;
  ai_reasoning:    string | null;
}

// ─── Market status helper ─────────────────────────────────────────────────────
type MarketStatus = "open" | "closed" | "pre" | "after";

function getMarketStatus(): MarketStatus {
  const now = new Date();
  // Convert to ET
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  const day = et.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return "closed";

  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;

  if (mins < 4 * 60)          return "closed";
  if (mins < 9 * 60 + 30)     return "pre";
  if (mins < 16 * 60)         return "open";
  if (mins < 20 * 60)         return "after";
  return "closed";
}

function MarketStatusBadge() {
  const [status, setStatus] = useState<MarketStatus>(getMarketStatus);

  useEffect(() => {
    const t = setInterval(() => setStatus(getMarketStatus()), 30_000);
    return () => clearInterval(t);
  }, []);

  const cfg: Record<MarketStatus, { label: string; color: string; bg: string }> = {
    open:   { label: "Market Open",   color: C.green,  bg: C.greenBg },
    pre:    { label: "Pre-Market",    color: C.yellow, bg: C.yellowBg },
    after:  { label: "After-Hours",   color: C.yellow, bg: C.yellowBg },
    closed: { label: "Market Closed", color: C.textSub, bg: C.cardBorder + "80" },
  };
  const { label, color, bg } = cfg[status];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 100,
        borderWidth: 1,
        borderColor: color + "40",
      }}
    >
      <View
        style={{
          width: 6, height: 6, borderRadius: 3,
          backgroundColor: color,
          opacity: status === "open" ? 1 : 0.7,
        }}
      />
      <Text style={{ color, fontSize: 11, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(v: number, compact = false): string {
  if (compact && Math.abs(v) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
    }).format(v);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "America/New_York",
  });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: "America/New_York",
  });
}

function pnlColor(v: number | null): string {
  if (v === null || v === 0) return C.textSub;
  return v > 0 ? C.green : C.red;
}

function actionColor(action: string): string {
  if (action === "traded") return C.green;
  if (action === "error")  return C.red;
  return C.textSub;
}

function strategyLabel(s: string): string {
  const map: Record<string, string> = {
    momentum_rider: "Trend Rider",
    mean_reversion: "Bargain Hunter",
    news_trader:    "News Trader",
    prediction_arb: "Prediction Pro",
    dca_plus:       "Smart DCA",
    blind_quant:    "Blind Quant",
    custom:         "Your Rules",
  };
  return map[s] ?? s;
}

// ─── Status page ──────────────────────────────────────────────────────────────
export default function StatusPage() {
  const params = useLocalSearchParams<{ key?: string }>();
  const key    = params.key ?? "";

  const [summary,    setSummary]    = useState<Summary | null>(null);
  const [agents,     setAgents]     = useState<AgentRow[]>([]);
  const [logs,       setLogs]       = useState<LogRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [logsOpen,   setLogsOpen]   = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const accessGranted = key === STATUS_KEY;

  const load = useCallback(async (silent = false) => {
    if (!accessGranted) return;
    if (!silent) setError(null);
    try {
      const [sumRes, agRes, logRes] = await Promise.all([
        supabase.rpc("rpc_get_status_summary", { p_secret_key: key }),
        supabase.rpc("rpc_get_status_agents",  { p_secret_key: key }),
        supabase.rpc("rpc_get_status_logs",    { p_secret_key: key, p_limit: 50 }),
      ]);

      if (sumRes.error) throw new Error(sumRes.error.message);
      if (agRes.error)  throw new Error(agRes.error.message);
      if (logRes.error) throw new Error(logRes.error.message);

      // Summary RPC returns an array of rows; take the first
      const sumRows = sumRes.data as Summary[];
      setSummary(sumRows?.[0] ?? null);
      setAgents((agRes.data as AgentRow[]) ?? []);
      setLogs((logRes.data as LogRow[]) ?? []);
      setLastRefresh(new Date());
    } catch (e: any) {
      if (!silent) setError(e.message ?? "Failed to load status");
    }
  }, [accessGranted, key]);

  // Initial load
  useEffect(() => {
    if (!accessGranted) return;
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load, accessGranted]);

  // Auto-refresh every 60 s
  useEffect(() => {
    if (!accessGranted) return;
    intervalRef.current = setInterval(() => load(true), AUTO_REFRESH_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load, accessGranted]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // ── Lock screen ─────────────────────────────────────────────────────────────
  if (!accessGranted) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>🔒</Text>
        <Text style={{ color: C.text, fontSize: 20, fontWeight: "700", textAlign: "center" }}>
          Access Denied
        </Text>
        <Text style={{ color: C.textSub, fontSize: 14, textAlign: "center", marginTop: 8, lineHeight: 20 }}>
          Add{" "}
          <Text style={{ color: C.accent, fontFamily: Platform.OS === "web" ? "monospace" : undefined }}>
            ?key=agentvault2026
          </Text>
          {" "}to the URL.
        </Text>
      </View>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={{ color: C.textSub, marginTop: 12, fontSize: 14 }}>Loading status…</Text>
      </View>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Text style={{ color: C.red, fontSize: 16, textAlign: "center" }}>⚠ {error}</Text>
        <Pressable onPress={() => load()} style={{ marginTop: 16 }}>
          <Text style={{ color: C.accent, fontWeight: "600" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const isUp      = (summary?.total_pnl ?? 0) >= 0;
  const hasAgents = agents.length > 0;
  const todayDate = summary?.today_date ?? new Date().toISOString().slice(0, 10);

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: 60,
        maxWidth: 860,
        alignSelf: "center",
        width: "100%",
      }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={{ paddingTop: 28, paddingBottom: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: C.accentBg,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 18 }}>🤖</Text>
            </View>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 }}>
              AgentVault
            </Text>
          </View>
          <MarketStatusBadge />
        </View>

        <Text style={{ color: C.text, fontSize: 15, fontWeight: "600", marginTop: 14 }}>
          {fmtDate(todayDate)}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent }} />
          <Text style={{ color: C.textSub, fontSize: 12 }}>
            {lastRefresh
              ? `Updated ${lastRefresh.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/New_York" })} ET · auto-refreshes every 60s`
              : "Loading…"}
          </Text>
        </View>
      </View>

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      {summary ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          {/* Total P&L — hero card */}
          <View
            style={{
              flex: 1,
              minWidth: 160,
              backgroundColor: isUp ? C.greenBg : C.redBg,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: (isUp ? C.green : C.red) + "30",
              padding: 16,
              gap: 4,
            }}
          >
            <Text style={{ color: isUp ? C.green : C.red, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>
              Total P&L
            </Text>
            <Text style={{ color: isUp ? C.green : C.red, fontSize: 30, fontWeight: "800", letterSpacing: -1 }}>
              {isUp ? "+" : ""}{fmt$(summary.total_pnl)}
            </Text>
            <Text style={{ color: (isUp ? C.green : C.red) + "99", fontSize: 12, fontWeight: "600" }}>
              {summary.total_trades} trade{summary.total_trades !== 1 ? "s" : ""}
            </Text>
          </View>

          {/* Win Rate */}
          <View style={[styles.summaryCard, { minWidth: 120 }]}>
            <Text style={styles.summaryLabel}>Win Rate</Text>
            <Text style={[styles.summaryValue, {
              color: summary.win_rate >= 55 ? C.green : summary.win_rate >= 45 ? C.yellow : C.red,
            }]}>
              {summary.total_trades > 0 ? `${summary.win_rate}%` : "—"}
            </Text>
            <Text style={styles.summaryHint}>
              {summary.winning_trades}W / {summary.losing_trades}L
            </Text>
          </View>

          {/* Best trade */}
          <View style={[styles.summaryCard, { minWidth: 130 }]}>
            <Text style={styles.summaryLabel}>Best Trade</Text>
            <Text style={[styles.summaryValue, { color: C.green, fontSize: 18 }]}>
              {summary.best_symbol ?? "—"}
            </Text>
            {summary.best_pnl !== null && (
              <Text style={{ color: C.green, fontSize: 13, fontWeight: "700" }}>
                +{fmt$(summary.best_pnl)}
              </Text>
            )}
          </View>

          {/* Worst trade */}
          <View style={[styles.summaryCard, { minWidth: 130 }]}>
            <Text style={styles.summaryLabel}>Worst Trade</Text>
            <Text style={[styles.summaryValue, { color: C.red, fontSize: 18 }]}>
              {summary.worst_symbol ?? "—"}
            </Text>
            {summary.worst_pnl !== null && summary.worst_pnl < 0 && (
              <Text style={{ color: C.red, fontSize: 13, fontWeight: "700" }}>
                {fmt$(summary.worst_pnl)}
              </Text>
            )}
          </View>
        </View>
      ) : (
        <EmptyCard message="No trading activity today." />
      )}

      {/* ── Per-agent breakdown ──────────────────────────────────────────────── */}
      <SectionTitle title="Agents" count={agents.length} />
      {!hasAgents ? (
        <EmptyCard message="No agent activity today." />
      ) : (
        <View style={styles.card}>
          {/* Table header */}
          <View style={[styles.tableRow, { backgroundColor: C.cardBorder + "80", borderBottomWidth: 1, borderBottomColor: C.divider }]}>
            {["Agent", "Strategy", "Trades", "P&L", "Win %", "Last Signal"].map((h) => (
              <Text
                key={h}
                style={[
                  styles.tableHeader,
                  h === "Agent" || h === "Strategy" ? { flex: 2 } : { flex: 1, textAlign: "right" },
                ]}
              >
                {h}
              </Text>
            ))}
          </View>
          {agents.map((ag, i) => (
            <View key={ag.agent_id}>
              <View style={styles.tableRow}>
                <View style={{ flex: 2 }}>
                  <Text style={{ color: C.text, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
                    {ag.agent_name}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                    <View
                      style={{
                        width: 6, height: 6, borderRadius: 3,
                        backgroundColor: ag.status === "active" ? C.green : C.textSub,
                      }}
                    />
                    <Text style={{ color: C.textSub, fontSize: 10, textTransform: "capitalize" }}>
                      {ag.status}
                    </Text>
                    <Text style={{ color: C.textTertiary, fontSize: 10 }}>·</Text>
                    <Text style={{ color: C.textSub, fontSize: 10, textTransform: "capitalize" }}>
                      {ag.mode}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.tableCell, { flex: 2, color: C.textSub }]} numberOfLines={1}>
                  {strategyLabel(ag.strategy)}
                </Text>
                <Text style={[styles.tableCell, { flex: 1 }]}>{ag.trades_today}</Text>
                <Text style={[styles.tableCell, { flex: 1, color: pnlColor(ag.pnl_today) }]}>
                  {ag.trades_today > 0
                    ? `${ag.pnl_today >= 0 ? "+" : ""}${fmt$(ag.pnl_today, true)}`
                    : "—"}
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    {
                      flex: 1,
                      color: ag.trades_today > 0
                        ? ag.win_rate_today >= 50 ? C.green : C.red
                        : C.textSub,
                    },
                  ]}
                >
                  {ag.trades_today > 0 ? `${ag.win_rate_today}%` : "—"}
                </Text>
                <Text style={[styles.tableCell, { flex: 1, color: C.textSub, fontSize: 10 }]}>
                  {ag.last_signal_at ? fmtTime(ag.last_signal_at) : "—"}
                </Text>
              </View>
              {i < agents.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>
      )}

      {/* ── Execution Logs (collapsible) ─────────────────────────────────────── */}
      <Pressable onPress={() => setLogsOpen((o) => !o)}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24, marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: "800" }}>Execution Logs</Text>
            <View style={{ backgroundColor: C.cardBorder, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 }}>
              <Text style={{ color: C.textSub, fontSize: 11, fontWeight: "700" }}>{logs.length}</Text>
            </View>
          </View>
          <Text style={{ color: C.accent, fontSize: 13, fontWeight: "600" }}>
            {logsOpen ? "Collapse ↑" : "Expand ↓"}
          </Text>
        </View>
      </Pressable>

      {logsOpen && (
        logs.length === 0 ? (
          <EmptyCard message="No execution logs today." />
        ) : (
          <View style={[styles.card, { gap: 0 }]}>
            {logs.map((log, i) => (
              <View key={log.log_id}>
                <LogRowItem log={log} />
                {i < logs.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        )
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <View style={{ marginTop: 32, alignItems: "center", gap: 4 }}>
        <Text style={{ color: C.textTertiary, fontSize: 11 }}>
          AgentVault · All times in ET · Pull to refresh · Auto-refreshes every 60s
        </Text>
        <Text style={{ color: C.textTertiary, fontSize: 10 }}>
          Paper trading data — not real money
        </Text>
      </View>
    </ScrollView>
  );
}

// ─── LogRowItem ───────────────────────────────────────────────────────────────
function LogRowItem({ log }: { log: LogRow }) {
  const [expanded, setExpanded] = useState(false);
  const aColor = actionColor(log.action);

  return (
    <Pressable onPress={() => setExpanded((e) => !e)} style={{ padding: 12 }}>
      {/* Top row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <View
          style={{
            backgroundColor: aColor + "18",
            paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5,
          }}
        >
          <Text style={{ color: aColor, fontSize: 10, fontWeight: "800", textTransform: "uppercase" }}>
            {log.action}
          </Text>
        </View>

        <Text style={{ color: C.text, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
          {log.agent_name}
        </Text>

        {log.trade_symbol && (
          <View
            style={{
              backgroundColor: C.accentBg,
              paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
            }}
          >
            <Text style={{ color: C.accent, fontSize: 11, fontWeight: "700" }}>
              {log.trade_symbol}
            </Text>
          </View>
        )}

        {log.signal_detected && !log.trade_symbol && log.signal_symbol && (
          <Text style={{ color: C.yellow, fontSize: 11 }}>
            ↑ Signal: {log.signal_symbol}
          </Text>
        )}

        <Text style={{ color: C.textSub, fontSize: 11, marginLeft: "auto" }}>
          {fmtTime(log.ts)}
        </Text>
      </View>

      {/* Subtitles */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <Text style={{ color: C.textSub, fontSize: 11 }}>{strategyLabel(log.strategy)}</Text>

        {log.trade_price !== null && (
          <>
            <Text style={{ color: C.textTertiary, fontSize: 11 }}>·</Text>
            <Text style={{ color: C.textSub, fontSize: 11 }}>
              @ {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(log.trade_price))}
            </Text>
          </>
        )}

        {log.trade_pnl !== null && log.trade_pnl !== 0 && (
          <>
            <Text style={{ color: C.textTertiary, fontSize: 11 }}>·</Text>
            <Text style={{ color: pnlColor(Number(log.trade_pnl)), fontSize: 11, fontWeight: "600" }}>
              P&L {Number(log.trade_pnl) >= 0 ? "+" : ""}
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(Number(log.trade_pnl))}
            </Text>
          </>
        )}

        {log.ai_confidence !== null && (
          <>
            <Text style={{ color: C.textTertiary, fontSize: 11 }}>·</Text>
            <Text style={{ color: C.textSub, fontSize: 11 }}>
              {Math.round(Number(log.ai_confidence) * 100)}% conf
            </Text>
          </>
        )}
      </View>

      {log.skip_reason && (
        <Text style={{ color: C.textSub, fontSize: 11, marginTop: 4, fontStyle: "italic" }}>
          {log.skip_reason.slice(0, 120)}
        </Text>
      )}

      {expanded && log.ai_reasoning && (
        <View
          style={{
            backgroundColor: C.cardBorder,
            borderRadius: 8, padding: 10, marginTop: 8,
          }}
        >
          <Text style={{ color: C.textSub, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
            AI Reasoning
          </Text>
          <Text
            style={{
              color: C.textSub,
              fontSize: 11,
              lineHeight: 16,
              fontFamily: Platform.OS === "web" ? "monospace" : undefined,
            }}
          >
            {log.ai_reasoning.slice(0, 600)}
            {log.ai_reasoning.length > 600 ? "…" : ""}
          </Text>
        </View>
      )}

      {log.ai_reasoning && (
        <Text style={{ color: C.textTertiary, fontSize: 10, marginTop: 4 }}>
          {expanded ? "▲ Collapse" : "▼ Tap for AI reasoning"}
        </Text>
      )}
    </Pressable>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────
function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, marginBottom: 10 }}>
      <Text style={{ color: C.text, fontSize: 16, fontWeight: "800" }}>{title}</Text>
      <View style={{ backgroundColor: C.cardBorder, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 }}>
        <Text style={{ color: C.textSub, fontSize: 11, fontWeight: "700" }}>{count}</Text>
      </View>
    </View>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <View style={[styles.card, { alignItems: "center", paddingVertical: 24, borderStyle: "dashed" }]}>
      <Text style={{ color: C.textSub, fontSize: 13 }}>{message}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    overflow: "hidden" as const,
    marginBottom: 4,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    padding: 14,
    gap: 4,
  },
  summaryLabel: {
    color: C.textSub,
    fontSize: 10,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
  },
  summaryValue: {
    color: C.text,
    fontSize: 22,
    fontWeight: "800" as const,
    letterSpacing: -0.5,
  },
  summaryHint: {
    color: C.textSub,
    fontSize: 11,
    fontWeight: "500" as const,
  },
  tableRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  tableHeader: {
    flex: 1,
    color: C.textSub,
    fontSize: 10,
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  },
  tableCell: {
    flex: 1,
    color: C.text,
    fontSize: 12,
    fontWeight: "500" as const,
    textAlign: "right" as const,
  },
  divider: {
    height: 1,
    backgroundColor: C.divider,
    marginHorizontal: 14,
  },
};
