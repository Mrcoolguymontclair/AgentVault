import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CardSkeleton } from "@/components/ui/LoadingSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";
import {
  fetchLeaderboard,
  fetchUserRank,
  type LeaderboardEntry,
} from "@/lib/services/leaderboardService";

type Period = "1D" | "1W" | "1M" | "ALL";

const PLAN_BADGES: Record<string, { label: string; variant: any }> = {
  elite: { label: "Elite", variant: "danger" },
  pro: { label: "Pro", variant: "accent" },
  free: { label: "Free", variant: "neutral" },
};

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

export default function LeaderboardScreen() {
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();
  const [period, setPeriod] = useState<Period>("1M");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myEntry, setMyEntry] = useState<LeaderboardEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const PERIODS: Period[] = ["1D", "1W", "1M", "ALL"];

  const load = useCallback(async () => {
    const [lbResult, rankResult] = await Promise.all([
      fetchLeaderboard(50),
      authUser?.id ? fetchUserRank(authUser.id) : Promise.resolve({ data: null, error: null }),
    ]);

    if (lbResult.error) {
      setError(lbResult.error);
    } else {
      setEntries(lbResult.data ?? []);
      setError(null);
    }

    if (rankResult.data && authUser) {
      // Find user's full entry in the leaderboard list
      const found = (lbResult.data ?? []).find((e) => e.id === authUser.id);
      if (found) {
        setMyEntry(found);
      } else {
        // User is outside top 50, build partial entry from rank query
        setMyEntry({
          id: authUser.id,
          display_name: authUser.user_metadata?.display_name ?? "You",
          avatar: authUser.user_metadata?.avatar ?? "🚀",
          plan: "free",
          win_rate: rankResult.data.win_rate ?? 0,
          total_pnl: 0,
          total_return_pct: rankResult.data.total_return_pct ?? 0,
          agent_count: rankResult.data.agent_count ?? 0,
          trade_count: rankResult.data.trade_count ?? 0,
          rank: rankResult.data.rank ?? 0,
        });
      }
    }
  }, [authUser?.id]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const top3 = entries.filter((e) => e.rank <= 3);
  const rest = entries.filter((e) => e.rank > 3 && e.rank <= 10);
  const userOutsideTop10 = myEntry && myEntry.rank > 10;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
          <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.8 }}>
            Leaderboard
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
            Top agents by return — updated live
          </Text>
        </View>

        {/* Period Filter */}
        <View
          style={{
            flexDirection: "row",
            marginHorizontal: 16,
            backgroundColor: colors.card,
            borderRadius: 12,
            padding: 4,
            marginBottom: 20,
            borderWidth: 1,
            borderColor: colors.cardBorder,
          }}
        >
          {PERIODS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 9,
                backgroundColor: period === p ? Colors.accent : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: period === p ? "#FFFFFF" : colors.textSecondary,
                  fontWeight: "700",
                  fontSize: 14,
                }}
              >
                {p}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </View>
        ) : error ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Could not load leaderboard"
            description={error}
          />
        ) : entries.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title="No Rankings Yet"
            description="Be the first to trade and claim the #1 spot."
          />
        ) : (
          <>
            {/* Podium — Top 3 */}
            {top3.length === 3 && (
              <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
                  <PodiumCard entry={top3[1]} height={110} medalColor={Colors.silver} colors={colors} />
                  <PodiumCard entry={top3[0]} height={140} medalColor={Colors.gold} colors={colors} crown />
                  <PodiumCard entry={top3[2]} height={90} medalColor={Colors.bronze} colors={colors} />
                </View>
              </View>
            )}

            {/* Rank List */}
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
                Rankings 4–10
              </Text>

              {rest.map((entry) => (
                <LeaderboardRow
                  key={entry.id}
                  entry={entry}
                  colors={colors}
                  isMe={entry.id === authUser?.id}
                />
              ))}

              {/* Divider with user rank if outside top 10 */}
              {userOutsideTop10 && myEntry && (
                <>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 8,
                    }}
                  >
                    <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
                    <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                      Your rank
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
                  </View>
                  <LeaderboardRow entry={myEntry} colors={colors} isMe />
                </>
              )}
            </View>

            {/* My Stats */}
            {myEntry && (
              <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
                <Card
                  style={{
                    borderColor: Colors.accent,
                    borderWidth: 1.5,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        backgroundColor: Colors.accentBg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>{myEntry.avatar}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}>
                        Your Performance
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                        Global rank #{myEntry.rank} · {myEntry.plan} plan
                      </Text>
                    </View>
                    <Badge label="You" variant="accent" size="sm" />
                  </View>

                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {[
                      { label: "Return", value: formatPercent(myEntry.total_return_pct) },
                      { label: "Win Rate", value: `${myEntry.win_rate}%` },
                      { label: "Agents", value: `${myEntry.agent_count}` },
                    ].map((s) => (
                      <View
                        key={s.label}
                        style={{
                          flex: 1,
                          backgroundColor: colors.cardSecondary,
                          borderRadius: 12,
                          padding: 12,
                          gap: 4,
                        }}
                      >
                        <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: "600", textTransform: "uppercase" }}>
                          {s.label}
                        </Text>
                        <Text style={{ color: Colors.success, fontWeight: "800", fontSize: 16 }}>
                          {s.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Card>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PodiumCard({
  entry,
  height,
  medalColor,
  crown,
  colors,
}: {
  entry: LeaderboardEntry;
  height: number;
  medalColor: string;
  crown?: boolean;
  colors: any;
}) {
  return (
    <Pressable
      style={{
        flex: 1,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: 16,
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 8,
        gap: 6,
        height: height + 80,
        justifyContent: "flex-end",
        shadowColor: medalColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
        elevation: 4,
      }}
    >
      {crown && (
        <Text style={{ fontSize: 20, position: "absolute", top: 10 }}>👑</Text>
      )}
      <Text style={{ fontSize: 28 }}>{entry.avatar}</Text>
      <Text
        style={{
          color: colors.text,
          fontWeight: "800",
          fontSize: 13,
          textAlign: "center",
        }}
        numberOfLines={1}
      >
        {entry.display_name.split(" ")[0]}
      </Text>
      <View
        style={{
          backgroundColor: medalColor + "22",
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 100,
        }}
      >
        <Text style={{ color: medalColor, fontWeight: "800", fontSize: 12 }}>
          {formatPercent(entry.total_return_pct)}
        </Text>
      </View>
      <View
        style={{
          width: "100%",
          height: height,
          backgroundColor: medalColor + "15",
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          borderTopWidth: 2,
          borderTopColor: medalColor,
        }}
      >
        <Text style={{ color: medalColor, fontWeight: "900", fontSize: 22 }}>
          #{entry.rank}
        </Text>
      </View>
    </Pressable>
  );
}

function LeaderboardRow({
  entry,
  colors,
  isMe,
}: {
  entry: LeaderboardEntry;
  colors: any;
  isMe: boolean;
}) {
  const pb = PLAN_BADGES[entry.plan] ?? PLAN_BADGES.free;

  return (
    <Pressable
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: isMe ? Colors.accentBg : colors.card,
        borderRadius: 14,
        padding: 14,
        gap: 12,
        borderWidth: isMe ? 1.5 : 1,
        borderColor: isMe ? Colors.accent : colors.cardBorder,
      }}
    >
      {/* Rank */}
      <View style={{ width: 32, alignItems: "center" }}>
        {entry.rank <= 3 ? (
          <Text style={{ fontSize: 20 }}>{RANK_MEDALS[entry.rank - 1]}</Text>
        ) : (
          <Text style={{ color: colors.textSecondary, fontWeight: "800", fontSize: 16 }}>
            {entry.rank}
          </Text>
        )}
      </View>

      {/* Avatar */}
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          backgroundColor: isMe ? Colors.accentBg : colors.cardSecondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 20 }}>{entry.avatar}</Text>
      </View>

      {/* Info */}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
            {entry.display_name}
          </Text>
          {isMe && <Badge label="You" variant="accent" size="sm" />}
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
          {entry.agent_count} agents · {entry.trade_count} trades
        </Text>
      </View>

      {/* Return */}
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Text style={{ color: Colors.success, fontWeight: "800", fontSize: 16 }}>
          {formatPercent(entry.total_return_pct)}
        </Text>
        <Badge label={pb.label} variant={pb.variant} size="sm" />
      </View>
    </Pressable>
  );
}
