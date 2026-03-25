import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  View,
  Text,
  FlatList,
  ScrollView,
  Pressable,
  RefreshControl,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Skeleton } from "@/components/ui/LoadingSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Colors } from "@/constants/colors";
import { formatPercent, formatCompact } from "@/utils/format";
import { STRATEGIES, RISK_CONFIG, type StrategyId } from "@/constants/strategies";
import {
  fetchAgentLeaderboard,
  fetchPeriodReturns,
  fetchTrendingAgents,
  fetchFollowedAgentIds,
  followAgent,
  unfollowAgent,
  type AgentLeaderboardEntry,
} from "@/lib/services/leaderboardService";

type Period = "1W" | "1M" | "3M" | "ALL";

const PERIODS: { label: string; value: Period; days: number }[] = [
  { label: "1W", value: "1W", days: 7 },
  { label: "1M", value: "1M", days: 30 },
  { label: "3M", value: "3M", days: 90 },
  { label: "All Time", value: "ALL", days: 0 },
];

const RANK_MEDAL_COLORS = [Colors.gold, Colors.silver, Colors.bronze];
const ROW_HEIGHT = 84;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function periodDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function strategyInfo(id: string) {
  return STRATEGIES.find((s) => s.id === (id as StrategyId));
}

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function LeaderboardScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user: authUser } = useAuthStore();

  const [allEntries, setAllEntries] = useState<AgentLeaderboardEntry[]>([]);
  const [trending, setTrending] = useState<AgentLeaderboardEntry[]>([]);
  const [periodReturns, setPeriodReturns] = useState<Record<string, number>>({});
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [followCounts, setFollowCounts] = useState<Record<string, number>>({});

  const [period, setPeriod] = useState<Period>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Data fetching ─────────────────────────────────────────

  const load = useCallback(async () => {
    const [lbResult, trendResult] = await Promise.all([
      fetchAgentLeaderboard(100),
      fetchTrendingAgents(6),
    ]);

    setAllEntries(lbResult.data);
    setTrending(trendResult);

    // Seed follow counts from DB data
    const counts: Record<string, number> = {};
    for (const e of lbResult.data) counts[e.id] = e.followers_count;
    setFollowCounts(counts);

    // Load user's followed agent IDs
    if (authUser?.id) {
      const ids = await fetchFollowedAgentIds(authUser.id);
      setFollowedIds(ids);
    }
  }, [authUser?.id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Fetch period-specific returns whenever period changes (except ALL)
  useEffect(() => {
    if (period === "ALL") {
      setPeriodReturns({});
      return;
    }
    const days = PERIODS.find((p) => p.value === period)?.days ?? 30;
    fetchPeriodReturns(periodDate(days)).then(setPeriodReturns);
  }, [period]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    if (period !== "ALL") {
      const days = PERIODS.find((p) => p.value === period)?.days ?? 30;
      const returns = await fetchPeriodReturns(periodDate(days));
      setPeriodReturns(returns);
    }
    setRefreshing(false);
  }

  // ── Derived data ─────────────────────────────────────────

  const sortedEntries = useMemo<AgentLeaderboardEntry[]>(() => {
    if (period === "ALL") return allEntries;

    return [...allEntries]
      .map((e) => ({
        ...e,
        period_pnl: periodReturns[e.id] ?? 0,
      }))
      .sort((a, b) => (b.period_pnl ?? 0) - (a.period_pnl ?? 0))
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }, [allEntries, period, periodReturns]);

  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return sortedEntries;
    const q = searchQuery.toLowerCase();
    return sortedEntries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.display_name.toLowerCase().includes(q) ||
        e.strategy.toLowerCase().includes(q)
    );
  }, [sortedEntries, searchQuery]);

  const top3 = useMemo(() => filteredEntries.filter((e) => e.rank <= 3), [filteredEntries]);
  const rest = useMemo(() => filteredEntries.filter((e) => e.rank > 3), [filteredEntries]);
  const myEntries = useMemo(
    () => filteredEntries.filter((e) => e.user_id === authUser?.id),
    [filteredEntries, authUser?.id]
  );

  // ── Follow handlers (optimistic) ────────────────────────

  const handleFollow = useCallback(
    async (agentId: string) => {
      if (!authUser?.id) return;
      const wasFollowing = followedIds.has(agentId);
      const nextFollowing = !wasFollowing;

      setFollowedIds((prev) => {
        const next = new Set(prev);
        nextFollowing ? next.add(agentId) : next.delete(agentId);
        return next;
      });
      setFollowCounts((prev) => ({
        ...prev,
        [agentId]: (prev[agentId] ?? 0) + (nextFollowing ? 1 : -1),
      }));

      const { error } = nextFollowing
        ? await followAgent(authUser.id, agentId)
        : await unfollowAgent(authUser.id, agentId);

      if (error) {
        // Revert
        setFollowedIds((prev) => {
          const next = new Set(prev);
          wasFollowing ? next.add(agentId) : next.delete(agentId);
          return next;
        });
        setFollowCounts((prev) => ({
          ...prev,
          [agentId]: (prev[agentId] ?? 0) + (nextFollowing ? -1 : 1),
        }));
      }
    },
    [authUser?.id, followedIds]
  );

  // ── Render helpers ───────────────────────────────────────

  const renderItem = useCallback(
    ({ item, index }: { item: AgentLeaderboardEntry; index: number }) => (
      <AgentRow
        entry={item}
        colors={colors}
        isMe={item.user_id === authUser?.id}
        isFollowing={followedIds.has(item.id)}
        followerCount={followCounts[item.id] ?? item.followers_count}
        period={period}
        onPress={() => router.push(`/agent/${item.id}` as any)}
        onFollow={() => handleFollow(item.id)}
      />
    ),
    [colors, authUser?.id, followedIds, followCounts, period, router, handleFollow]
  );

  const ListHeader = (
    <View>
      {/* Page Title */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 }}>
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.8 }}>
          Leaderboard
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
          Top public agents by return
        </Text>
      </View>

      {/* Search Bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginHorizontal: 16,
          marginBottom: 14,
          paddingHorizontal: 14,
          paddingVertical: 11,
          backgroundColor: colors.card,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: searchQuery ? Colors.accent : colors.cardBorder,
          gap: 10,
        }}
      >
        <Ionicons name="search" size={18} color={colors.textTertiary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search agents, strategies, traders…"
          placeholderTextColor={colors.textTertiary}
          style={{ flex: 1, color: colors.text, fontSize: 15, padding: 0 }}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>

      {/* Trending Section */}
      {trending.length > 0 && !searchQuery && (
        <View style={{ marginBottom: 16 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 16,
              marginBottom: 10,
            }}
          >
            <Text style={{ fontSize: 16 }}>🔥</Text>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
              Trending Today
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          >
            {trending.map((entry) => (
              <TrendingCard
                key={entry.id}
                entry={entry}
                colors={colors}
                onPress={() => router.push(`/agent/${entry.id}` as any)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Period Filter */}
      <View
        style={{
          flexDirection: "row",
          marginHorizontal: 16,
          backgroundColor: colors.card,
          borderRadius: 12,
          padding: 4,
          marginBottom: 16,
          borderWidth: 1,
          borderColor: colors.cardBorder,
        }}
      >
        {PERIODS.map((p) => (
          <Pressable
            key={p.value}
            onPress={() => setPeriod(p.value)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 9,
              backgroundColor: period === p.value ? Colors.accent : "transparent",
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: period === p.value ? "#FFFFFF" : colors.textSecondary,
                fontWeight: "700",
                fontSize: 13,
              }}
            >
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Podium — only show for top 3 when not searching */}
      {top3.length === 3 && !searchQuery && (
        <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            <PodiumCard
              entry={top3[1]}
              height={100}
              medalColor={Colors.silver}
              colors={colors}
              period={period}
              periodReturns={periodReturns}
              onPress={() => router.push(`/agent/${top3[1].id}` as any)}
            />
            <PodiumCard
              entry={top3[0]}
              height={130}
              medalColor={Colors.gold}
              colors={colors}
              crown
              period={period}
              periodReturns={periodReturns}
              onPress={() => router.push(`/agent/${top3[0].id}` as any)}
            />
            <PodiumCard
              entry={top3[2]}
              height={80}
              medalColor={Colors.bronze}
              colors={colors}
              period={period}
              periodReturns={periodReturns}
              onPress={() => router.push(`/agent/${top3[2].id}` as any)}
            />
          </View>
        </View>
      )}

      {/* Section label */}
      {filteredEntries.length > 0 && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            marginBottom: 10,
          }}
        >
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 11,
              fontWeight: "700",
              textTransform: "uppercase",
              letterSpacing: 0.8,
            }}
          >
            {searchQuery
              ? `${filteredEntries.length} result${filteredEntries.length !== 1 ? "s" : ""}`
              : top3.length === 3 && !searchQuery
              ? "Rankings 4+"
              : "All Rankings"}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            {PERIODS.find((p) => p.value === period)?.label} Return
          </Text>
        </View>
      )}
    </View>
  );

  const ListFooter =
    myEntries.length > 0 && !searchQuery ? (
      <MyAgentsCard
        entries={myEntries}
        colors={colors}
        period={period}
        periodReturns={periodReturns}
        onPress={(id) => router.push(`/agent/${id}` as any)}
      />
    ) : (
      <View style={{ height: 24 }} />
    );

  // ── Skeleton loading ──────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 }}>
          <Skeleton width="55%" height={26} borderRadius={8} />
          <View style={{ height: 8 }} />
          <Skeleton width="40%" height={13} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {[...Array(6)].map((_, i) => (
            <AgentRowSkeleton key={i} colors={colors} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <FlatList
        data={searchQuery ? filteredEntries : top3.length === 3 ? rest : filteredEntries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={
          <EmptyState
            icon="trophy-outline"
            title={searchQuery ? "No Results" : "No Public Agents Yet"}
            description={
              searchQuery
                ? `No agents matching "${searchQuery}".`
                : "Be the first to deploy a public agent and claim #1."
            }
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        maxToRenderPerBatch={20}
        windowSize={10}
        initialNumToRender={15}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// Trending Card (horizontal scroll)
// ─────────────────────────────────────────────────────────────
function TrendingCard({
  entry,
  colors,
  onPress,
}: {
  entry: AgentLeaderboardEntry;
  colors: any;
  onPress: () => void;
}) {
  const strat = strategyInfo(entry.strategy);
  const pnl = entry.period_pnl ?? entry.pnl_pct;
  const isPos = pnl >= 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 140,
        backgroundColor: pressed ? colors.cardSecondary : colors.card,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: isPos ? Colors.success + "44" : Colors.danger + "44",
        padding: 14,
        gap: 8,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 22 }}>{strat?.icon ?? "🤖"}</Text>
        <View
          style={{
            backgroundColor: isPos ? Colors.successBg : Colors.dangerBg,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 100,
          }}
        >
          <Text
            style={{
              color: isPos ? Colors.success : Colors.danger,
              fontWeight: "800",
              fontSize: 12,
            }}
          >
            {formatPercent(pnl)}
          </Text>
        </View>
      </View>
      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }} numberOfLines={1}>
        {entry.name}
      </Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11 }} numberOfLines={1}>
        {entry.avatar} {entry.display_name}
      </Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// Podium Card (top 3)
// ─────────────────────────────────────────────────────────────
function PodiumCard({
  entry,
  height,
  medalColor,
  crown,
  colors,
  period,
  periodReturns,
  onPress,
}: {
  entry: AgentLeaderboardEntry;
  height: number;
  medalColor: string;
  crown?: boolean;
  colors: any;
  period: Period;
  periodReturns: Record<string, number>;
  onPress: () => void;
}) {
  const strat = strategyInfo(entry.strategy);
  const returnPct =
    period === "ALL"
      ? entry.pnl_pct
      : entry.budget > 0
      ? ((periodReturns[entry.id] ?? 0) / entry.budget) * 100
      : 0;

  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: 16,
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 6,
        gap: 5,
        height: height + 90,
        justifyContent: "flex-end",
      }}
    >
      {crown && (
        <Text style={{ fontSize: 18, position: "absolute", top: 8 }}>👑</Text>
      )}
      <Text style={{ fontSize: 24 }}>{strat?.icon ?? "🤖"}</Text>
      <Text style={{ fontSize: 20 }}>{entry.avatar}</Text>
      <Text
        style={{ color: colors.text, fontWeight: "800", fontSize: 12, textAlign: "center" }}
        numberOfLines={1}
      >
        {entry.name.length > 10 ? entry.name.slice(0, 9) + "…" : entry.name}
      </Text>
      <View
        style={{
          backgroundColor: medalColor + "25",
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 100,
        }}
      >
        <Text style={{ color: medalColor, fontWeight: "800", fontSize: 12 }}>
          {formatPercent(returnPct)}
        </Text>
      </View>
      <View
        style={{
          width: "100%",
          height,
          backgroundColor: medalColor + "18",
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          borderTopWidth: 2,
          borderTopColor: medalColor,
        }}
      >
        <Text style={{ color: medalColor, fontWeight: "900", fontSize: 20 }}>
          #{entry.rank}
        </Text>
      </View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// Agent Row
// ─────────────────────────────────────────────────────────────
function AgentRow({
  entry,
  colors,
  isMe,
  isFollowing,
  followerCount,
  period,
  onPress,
  onFollow,
}: {
  entry: AgentLeaderboardEntry;
  colors: any;
  isMe: boolean;
  isFollowing: boolean;
  followerCount: number;
  period: Period;
  onPress: () => void;
  onFollow: () => void;
}) {
  const strat = strategyInfo(entry.strategy);
  const riskConfig = strat ? RISK_CONFIG[strat.risk] : null;
  const returnPct =
    period === "ALL"
      ? entry.pnl_pct
      : entry.budget > 0
      ? ((entry.period_pnl ?? 0) / entry.budget) * 100
      : 0;
  const isPos = returnPct >= 0;
  const medalColor = entry.rank <= 3 ? RANK_MEDAL_COLORS[entry.rank - 1] : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: isMe
          ? Colors.accentBg
          : pressed
          ? colors.cardSecondary
          : colors.card,
        borderRadius: 16,
        padding: 14,
        gap: 10,
        borderWidth: isMe ? 1.5 : 1,
        borderColor: isMe ? Colors.accent : colors.cardBorder,
        minHeight: ROW_HEIGHT,
      })}
    >
      {/* Rank */}
      <View style={{ width: 28, alignItems: "center" }}>
        {medalColor ? (
          <Text style={{ fontSize: 18 }}>
            {["🥇", "🥈", "🥉"][entry.rank - 1]}
          </Text>
        ) : (
          <Text
            style={{
              color: colors.textSecondary,
              fontWeight: "800",
              fontSize: 15,
            }}
          >
            {entry.rank}
          </Text>
        )}
      </View>

      {/* Strategy Icon + Avatar stack */}
      <View style={{ position: "relative", width: 44, height: 44 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            backgroundColor: colors.cardSecondary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 22 }}>{strat?.icon ?? "🤖"}</Text>
        </View>
        {/* User avatar bubble */}
        <View
          style={{
            position: "absolute",
            bottom: -4,
            right: -4,
            width: 22,
            height: 22,
            borderRadius: 8,
            backgroundColor: colors.card,
            borderWidth: 1.5,
            borderColor: colors.cardBorder,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 11 }}>{entry.avatar}</Text>
        </View>
      </View>

      {/* Info */}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text
            style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}
            numberOfLines={1}
          >
            {entry.name}
          </Text>
          {isMe && <Badge label="You" variant="accent" />}
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
          {entry.display_name} · {strat?.name ?? entry.strategy}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
            {entry.win_rate > 0 ? `${entry.win_rate.toFixed(0)}% WR` : "No trades"}
          </Text>
          <Text style={{ color: colors.textTertiary }}>·</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="heart" size={11} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
              {formatCompact(followerCount)}
            </Text>
          </View>
          {riskConfig && (
            <>
              <Text style={{ color: colors.textTertiary }}>·</Text>
              <Text style={{ color: riskConfig.color, fontSize: 11, fontWeight: "600" }}>
                {riskConfig.label}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Right: return + follow */}
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Text
          style={{
            color: isPos ? Colors.success : Colors.danger,
            fontWeight: "800",
            fontSize: 16,
          }}
        >
          {formatPercent(returnPct)}
        </Text>
        {!isMe && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onFollow();
            }}
            hitSlop={8}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 100,
              backgroundColor: isFollowing ? Colors.accentBg : colors.cardSecondary,
              borderWidth: 1,
              borderColor: isFollowing ? Colors.accent : colors.cardBorder,
            }}
          >
            <Ionicons
              name={isFollowing ? "heart" : "heart-outline"}
              size={13}
              color={isFollowing ? Colors.accent : colors.textSecondary}
            />
            <Text
              style={{
                color: isFollowing ? Colors.accentLight : colors.textSecondary,
                fontSize: 11,
                fontWeight: "700",
              }}
            >
              {isFollowing ? "Following" : "Follow"}
            </Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// My Agents Card (footer)
// ─────────────────────────────────────────────────────────────
function MyAgentsCard({
  entries,
  colors,
  period,
  periodReturns,
  onPress,
}: {
  entries: AgentLeaderboardEntry[];
  colors: any;
  period: Period;
  periodReturns: Record<string, number>;
  onPress: (id: string) => void;
}) {
  const best = entries[0];
  const returnPct =
    period === "ALL"
      ? best.pnl_pct
      : best.budget > 0
      ? ((periodReturns[best.id] ?? 0) / best.budget) * 100
      : 0;
  const isPos = returnPct >= 0;
  const strat = strategyInfo(best.strategy);

  return (
    <View style={{ paddingTop: 20, paddingBottom: 8 }}>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 18,
          borderWidth: 1.5,
          borderColor: Colors.accent,
          padding: 16,
          gap: 14,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 40, height: 40, borderRadius: 13,
              backgroundColor: Colors.accentBg,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 20 }}>{best.avatar}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
              Your Best Agent
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              Rank #{best.rank} · {entries.length} public agent{entries.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <Badge label="You" variant="accent" />
        </View>

        <Pressable
          onPress={() => onPress(best.id)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: pressed ? colors.cardSecondary : colors.cardSecondary,
            borderRadius: 14,
            padding: 12,
          })}
        >
          <Text style={{ fontSize: 24 }}>{strat?.icon ?? "🤖"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>{best.name}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {strat?.name} · {best.win_rate.toFixed(0)}% win rate
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text
              style={{
                color: isPos ? Colors.success : Colors.danger,
                fontWeight: "800",
                fontSize: 18,
              }}
            >
              {formatPercent(returnPct)}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Skeleton row
// ─────────────────────────────────────────────────────────────
function AgentRowSkeleton({ colors }: { colors: any }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colors.card,
        borderRadius: 16,
        padding: 14,
        gap: 10,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        height: ROW_HEIGHT,
      }}
    >
      <Skeleton width={28} height={20} borderRadius={6} />
      <Skeleton width={44} height={44} borderRadius={14} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="55%" height={14} />
        <Skeleton width="70%" height={11} />
        <Skeleton width="45%" height={10} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Skeleton width={56} height={16} borderRadius={6} />
        <Skeleton width={70} height={26} borderRadius={100} />
      </View>
    </View>
  );
}
