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
  Pressable,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Colors } from "@/constants/colors";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/LoadingSkeleton";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency, formatPercent } from "@/utils/format";
import { STRATEGIES } from "@/constants/strategies";
import {
  fetchTradeFeed,
  subscribeToFeedTrades,
  fetchSuggestedAgentOwners,
  type FeedTrade,
  type SuggestedTrader,
} from "@/lib/services/socialService";
import {
  fetchFollowedAgentIds,
  fetchAgentLeaderboard,
  followAgent,
  unfollowAgent,
  type AgentLeaderboardEntry,
} from "@/lib/services/leaderboardService";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { StrategyId } from "@/constants/strategies";

type FeedTab = "feed" | "discover";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function tradeDescription(trade: FeedTrade) {
  const action = trade.side === "buy" ? "Bought" : "Sold";
  const qty =
    trade.quantity < 1
      ? trade.quantity.toFixed(4)
      : trade.quantity.toFixed(0);
  const price = formatCurrency(trade.price);
  return `${action} ${qty} ${trade.symbol} @ ${price}`;
}

// ─── Feed Item ────────────────────────────────────────────────

function FeedItem({
  trade,
  colors,
  onPressAgent,
  onPressTrader,
}: {
  trade: FeedTrade;
  colors: any;
  onPressAgent: () => void;
  onPressTrader: () => void;
}) {
  const isBuy = trade.side === "buy";
  const hasPnl = trade.pnl !== 0;
  const isProfit = trade.pnl >= 0;
  const stratDef = STRATEGIES.find((s) => s.id === (trade.agent_strategy as StrategyId));

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        padding: 16,
      }}
    >
      {/* Author Row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Pressable onPress={onPressTrader} hitSlop={6}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: colors.cardSecondary,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1.5,
              borderColor: Colors.accentBg,
            }}
          >
            <Text style={{ fontSize: 20 }}>{trade.owner_avatar}</Text>
          </View>
        </Pressable>

        <View style={{ flex: 1, gap: 2 }}>
          <Pressable onPress={onPressTrader} hitSlop={4}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>
              {trade.owner_display_name}
            </Text>
          </Pressable>
          <Pressable onPress={onPressAgent} hitSlop={4}>
            <Text style={{ color: Colors.accentLight, fontSize: 12, fontWeight: "600" }}>
              {stratDef?.icon ?? "🤖"} {trade.agent_name}
            </Text>
          </Pressable>
        </View>

        <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
          {timeAgo(trade.executed_at)}
        </Text>
      </View>

      {/* Trade Action */}
      <Pressable
        onPress={onPressAgent}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: colors.cardSecondary,
          borderRadius: 12,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.cardBorder,
        }}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: isBuy ? Colors.successBg : Colors.dangerBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={isBuy ? "arrow-down-circle" : "arrow-up-circle"}
            size={20}
            color={isBuy ? Colors.success : Colors.danger}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
            {tradeDescription(trade)}
          </Text>
          {stratDef && (
            <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>
              {stratDef.name}
            </Text>
          )}
        </View>

        {hasPnl && (
          <View
            style={{
              backgroundColor: isProfit ? Colors.successBg : Colors.dangerBg,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 8,
            }}
          >
            <Text
              style={{
                color: isProfit ? Colors.success : Colors.danger,
                fontWeight: "800",
                fontSize: 13,
              }}
            >
              {isProfit ? "+" : ""}
              {formatCurrency(trade.pnl)}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────

function FeedSkeleton({ colors }: { colors: any }) {
  return (
    <View style={{ gap: 0 }}>
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={{
            backgroundColor: colors.card,
            borderBottomWidth: 1,
            borderBottomColor: colors.divider,
            padding: 16,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: colors.skeleton,
              }}
            />
            <View style={{ gap: 6, flex: 1 }}>
              <View style={{ width: "40%", height: 12, borderRadius: 6, backgroundColor: colors.skeleton }} />
              <View style={{ width: "60%", height: 10, borderRadius: 5, backgroundColor: colors.skeleton }} />
            </View>
          </View>
          <View style={{ height: 60, borderRadius: 12, backgroundColor: colors.skeleton }} />
        </View>
      ))}
    </View>
  );
}

// ─── Discover Agent Card ──────────────────────────────────────

function DiscoverAgentCard({
  entry,
  colors,
  isFollowing,
  onFollow,
  onPress,
}: {
  entry: AgentLeaderboardEntry;
  colors: any;
  isFollowing: boolean;
  onFollow: () => void;
  onPress: () => void;
}) {
  const stratDef = STRATEGIES.find((s) => s.id === (entry.strategy as StrategyId));
  const isPositive = entry.pnl_pct >= 0;

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: colors.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 10,
      }}
    >
      {/* Strategy + Avatar overlay */}
      <View style={{ position: "relative", width: 46, height: 46 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            backgroundColor: Colors.accentBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 22 }}>{stratDef?.icon ?? "🤖"}</Text>
        </View>
        <View
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 20,
            height: 20,
            borderRadius: 6,
            backgroundColor: colors.cardSecondary,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: colors.card,
          }}
        >
          <Text style={{ fontSize: 10 }}>{entry.avatar}</Text>
        </View>
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text
          style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}
          numberOfLines={1}
        >
          {entry.name}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>
          {entry.display_name} · {stratDef?.name ?? entry.strategy}
        </Text>
      </View>

      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <Text
          style={{
            color: isPositive ? Colors.success : Colors.danger,
            fontWeight: "800",
            fontSize: 15,
          }}
        >
          {formatPercent(entry.pnl_pct)}
        </Text>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onFollow();
          }}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderRadius: 8,
            backgroundColor: isFollowing ? Colors.accentBg : colors.cardSecondary,
            borderWidth: 1,
            borderColor: isFollowing ? Colors.accent : colors.cardBorder,
          }}
        >
          <Text
            style={{
              color: isFollowing ? Colors.accentLight : colors.textSecondary,
              fontWeight: "700",
              fontSize: 12,
            }}
          >
            {isFollowing ? "Following" : "Follow"}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────

export default function SocialScreen() {
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<FeedTab>("feed");
  const [trades, setTrades] = useState<FeedTrade[]>([]);
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [leaderboard, setLeaderboard] = useState<AgentLeaderboardEntry[]>([]);
  const [followedAgentIds, setFollowedAgentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const realtimeRef = useRef<RealtimeChannel | null>(null);

  // Load feed
  const loadFeed = useCallback(async () => {
    if (!authUser?.id) return;
    const followed = await fetchFollowedAgentIds(authUser.id);
    setFollowedIds(followed);

    const { data } = await fetchTradeFeed([...followed], 40);
    setTrades(data);
  }, [authUser?.id]);

  // Load discover
  const loadDiscover = useCallback(async () => {
    const { data } = await fetchAgentLeaderboard(50);
    setLeaderboard(data);

    if (authUser?.id) {
      const followed = await fetchFollowedAgentIds(authUser.id);
      setFollowedAgentIds(followed);
    }
    setDiscoverLoading(false);
  }, [authUser?.id]);

  useEffect(() => {
    setLoading(true);
    loadFeed().finally(() => setLoading(false));
    loadDiscover();
  }, [loadFeed, loadDiscover]);

  // Realtime feed subscription
  useEffect(() => {
    if (followedIds.size === 0) return;
    realtimeRef.current?.unsubscribe();
    realtimeRef.current = subscribeToFeedTrades(followedIds, (newTrade) => {
      setTrades((prev) => [newTrade, ...prev].slice(0, 60));
    });
    return () => {
      realtimeRef.current?.unsubscribe();
    };
  }, [followedIds]);

  async function onRefresh() {
    setRefreshing(true);
    if (activeTab === "feed") await loadFeed();
    else await loadDiscover();
    setRefreshing(false);
  }

  async function handleFollow(agentId: string) {
    if (!authUser?.id) return;
    const isNowFollowing = !followedAgentIds.has(agentId);
    setFollowedAgentIds((prev) => {
      const next = new Set(prev);
      isNowFollowing ? next.add(agentId) : next.delete(agentId);
      return next;
    });

    const { error } = isNowFollowing
      ? await followAgent(authUser.id, agentId)
      : await unfollowAgent(authUser.id, agentId);

    if (error) {
      setFollowedAgentIds((prev) => {
        const next = new Set(prev);
        isNowFollowing ? next.delete(agentId) : next.add(agentId);
        return next;
      });
    }
  }

  const TABS: { key: FeedTab; label: string; icon: string }[] = [
    { key: "feed", label: "Feed", icon: "pulse-outline" },
    { key: "discover", label: "Discover", icon: "compass-outline" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 4,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 26,
            fontWeight: "800",
            letterSpacing: -0.8,
          }}
        >
          Social
        </Text>
        {activeTab === "feed" && trades.length > 0 && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              backgroundColor: Colors.successBg,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 10,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: Colors.success,
              }}
            />
            <Text style={{ color: Colors.success, fontWeight: "700", fontSize: 12 }}>
              Live
            </Text>
          </View>
        )}
      </View>

      {/* Tab Bar */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 16,
          gap: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.divider,
        }}
      >
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 12,
              borderBottomWidth: 2,
              borderBottomColor:
                activeTab === tab.key ? Colors.accent : "transparent",
            }}
          >
            <Ionicons
              name={tab.icon as any}
              size={16}
              color={
                activeTab === tab.key ? Colors.accent : colors.textSecondary
              }
            />
            <Text
              style={{
                color:
                  activeTab === tab.key ? Colors.accent : colors.textSecondary,
                fontWeight: "700",
                fontSize: 14,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Feed Tab */}
      {activeTab === "feed" ? (
        loading ? (
          <FeedSkeleton colors={colors} />
        ) : followedIds.size === 0 ? (
          <ScrollView
            contentContainerStyle={{ flex: 1 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={Colors.accent}
              />
            }
          >
            <EmptyState
              icon="pulse-outline"
              title="Your Feed is Empty"
              description="Follow agents from the Leaderboard to see their live trades here in real time."
              ctaLabel="Explore Leaderboard"
              onCta={() => router.push("/(tabs)/leaderboard")}
            />
          </ScrollView>
        ) : trades.length === 0 ? (
          <ScrollView
            contentContainerStyle={{ flex: 1 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={Colors.accent}
              />
            }
          >
            <EmptyState
              icon="swap-horizontal-outline"
              title="No Trades Yet"
              description="The agents you follow haven't made any trades recently. Check back during market hours."
            />
          </ScrollView>
        ) : (
          <FlatList
            data={trades}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <FeedItem
                trade={item}
                colors={colors}
                onPressAgent={() => router.push(`/agent/${item.agent_id}`)}
                onPressTrader={() =>
                  router.push(`/trader/${item.owner_user_id}`)
                }
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={Colors.accent}
              />
            }
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            maxToRenderPerBatch={15}
            initialNumToRender={12}
            windowSize={8}
          />
        )
      ) : (
        // Discover Tab
        <FlatList
          data={leaderboard}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View style={{ paddingTop: 16, paddingBottom: 8 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 18,
                  fontWeight: "800",
                  letterSpacing: -0.3,
                  paddingHorizontal: 16,
                  marginBottom: 4,
                }}
              >
                Top Agents
              </Text>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 13,
                  paddingHorizontal: 16,
                  marginBottom: 12,
                }}
              >
                Follow agents to see their trades in your feed
              </Text>
            </View>
          }
          ListEmptyComponent={
            discoverLoading ? (
              <View style={{ padding: 16, gap: 10 }}>
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </View>
            ) : (
              <EmptyState
                icon="trophy-outline"
                title="Leaderboard Empty"
                description="No public agents yet. Deploy an agent and make it public!"
              />
            )
          }
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: 16 }}>
              <DiscoverAgentCard
                entry={item}
                colors={colors}
                isFollowing={followedAgentIds.has(item.id)}
                onFollow={() => handleFollow(item.id)}
                onPress={() => router.push(`/agent/${item.id}`)}
              />
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={15}
          initialNumToRender={12}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </SafeAreaView>
  );
}
