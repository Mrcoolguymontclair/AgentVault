import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/LoadingSkeleton";
import { formatPercent } from "@/utils/format";
import { Colors } from "@/constants/colors";
import {
  fetchFeedPosts,
  fetchFollowingPosts,
  fetchSuggestedTraders,
  followUser,
  unfollowUser,
  likePost,
  unlikePost,
  type SocialPost,
  type SuggestedTrader,
} from "@/lib/services/socialService";

type FeedTab = "feed" | "following" | "discover";

const PLAN_COLORS: Record<string, string> = {
  elite: Colors.danger,
  pro: Colors.accentLight,
  free: "#8B8FA8",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function SocialScreen() {
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<FeedTab>("feed");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [suggested, setSuggested] = useState<SuggestedTrader[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set());

  const loadFeed = useCallback(async () => {
    if (!authUser?.id) return;
    const result = await fetchFeedPosts(20);
    if (result.data) setPosts(result.data);
  }, [authUser?.id]);

  const loadFollowing = useCallback(async () => {
    if (!authUser?.id) return;
    const result = await fetchFollowingPosts(authUser.id, 20);
    if (result.data) setPosts(result.data);
  }, [authUser?.id]);

  const loadSuggested = useCallback(async () => {
    if (!authUser?.id) return;
    const result = await fetchSuggestedTraders(authUser.id, 10);
    if (result.data) setSuggested(result.data);
  }, [authUser?.id]);

  useEffect(() => {
    setLoading(true);
    const tasks: Promise<void>[] = [loadFeed(), loadSuggested()];
    Promise.all(tasks).finally(() => setLoading(false));
  }, [loadFeed, loadSuggested]);

  useEffect(() => {
    if (activeTab === "following") {
      setLoading(true);
      loadFollowing().finally(() => setLoading(false));
    } else if (activeTab === "feed") {
      setLoading(true);
      loadFeed().finally(() => setLoading(false));
    }
  }, [activeTab]);

  async function onRefresh() {
    setRefreshing(true);
    if (activeTab === "feed") await loadFeed();
    else if (activeTab === "following") await loadFollowing();
    else await loadSuggested();
    setRefreshing(false);
  }

  async function toggleLike(post: SocialPost) {
    const isLiked = likedPostIds.has(post.id);
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      isLiked ? next.delete(post.id) : next.add(post.id);
      return next;
    });
    // Optimistic update
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, likes: p.likes + (isLiked ? -1 : 1) }
          : p
      )
    );
    if (isLiked) {
      await unlikePost(post.id, post.likes);
    } else {
      await likePost(post.id, post.likes);
    }
  }

  async function toggleFollow(trader: SuggestedTrader) {
    if (!authUser?.id) return;
    const isFollowing = suggested.find((t) => t.id === trader.id);
    // Toggle optimistically
    setSuggested((prev) => prev.filter((t) => t.id !== trader.id));
    await followUser(authUser.id, trader.id);
  }

  const TABS: { key: FeedTab; label: string }[] = [
    { key: "feed", label: "Feed" },
    { key: "following", label: "Following" },
    { key: "discover", label: "Discover" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.8 }}>
          Social
        </Text>
        <Pressable
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: Colors.accentBg,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 12,
          }}
        >
          <Ionicons name="create-outline" size={16} color={Colors.accentLight} />
          <Text style={{ color: Colors.accentLight, fontWeight: "700", fontSize: 13 }}>Post</Text>
        </Pressable>
      </View>

      {/* Tab Bar */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 16,
          gap: 4,
          marginBottom: 4,
        }}
      >
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: "center",
              borderBottomWidth: 2,
              borderBottomColor:
                activeTab === tab.key ? Colors.accent : "transparent",
            }}
          >
            <Text
              style={{
                color: activeTab === tab.key ? Colors.accent : colors.textSecondary,
                fontWeight: "700",
                fontSize: 14,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
          />
        }
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
      >
        {loading ? (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            <CardSkeleton />
            <CardSkeleton />
          </View>
        ) : activeTab === "discover" ? (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 }}>
              Suggested Traders
            </Text>
            {suggested.length === 0 ? (
              <EmptyState
                icon="people-outline"
                title="No Suggestions"
                description="You're already following everyone on the platform."
              />
            ) : (
              suggested.map((trader) => (
                <Card key={trader.id}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 14,
                        backgroundColor: colors.cardSecondary,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ fontSize: 26 }}>{trader.avatar}</Text>
                    </View>

                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: colors.text, fontWeight: "700", fontSize: 15 }}>
                          {trader.display_name}
                        </Text>
                        <Badge
                          label={trader.plan}
                          variant={trader.plan === "elite" ? "danger" : "accent"}
                          size="sm"
                        />
                      </View>
                      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                        {formatPercent(trader.total_return_pct)} return
                      </Text>
                    </View>

                    <Button
                      variant="primary"
                      size="sm"
                      onPress={() => toggleFollow(trader)}
                    >
                      Follow
                    </Button>
                  </View>
                </Card>
              ))
            )}

            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.3, marginTop: 8 }}>
              Trending Tags
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {[
                "#TrendFollowing", "#GroqAI", "#AlgoTrading", "#NVDA",
                "#RiskManagement", "#NewsTrading", "#Scalping", "#MeanReversion",
              ].map((tag) => (
                <Pressable
                  key={tag}
                  style={{
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 100,
                  }}
                >
                  <Text style={{ color: Colors.accentLight, fontWeight: "600", fontSize: 13 }}>
                    {tag}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : activeTab === "following" ? (
          posts.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="Nobody Followed Yet"
              description="Follow top traders to see their agent updates, trades, and insights here."
              ctaLabel="Discover Traders"
              onCta={() => setActiveTab("discover")}
            />
          ) : (
            <View style={{ gap: 1 }}>
              {posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  colors={colors}
                  isLiked={likedPostIds.has(post.id)}
                  onLike={() => toggleLike(post)}
                />
              ))}
            </View>
          )
        ) : posts.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title="No Posts Yet"
            description="Be the first to share your agent performance and trading insights."
          />
        ) : (
          <View style={{ gap: 1 }}>
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                colors={colors}
                isLiked={likedPostIds.has(post.id)}
                onLike={() => toggleLike(post)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PostCard({
  post,
  colors,
  isLiked,
  onLike,
}: {
  post: SocialPost;
  colors: any;
  isLiked: boolean;
  onLike: () => void;
}) {
  const plan = post.profiles?.plan ?? "free";
  const planColor = PLAN_COLORS[plan];

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        padding: 16,
        gap: 12,
      }}
    >
      {/* Author Row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 13,
            backgroundColor: colors.cardSecondary,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: planColor + "44",
          }}
        >
          <Text style={{ fontSize: 22 }}>{post.profiles?.avatar ?? "🚀"}</Text>
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
              {post.profiles?.display_name ?? "Trader"}
            </Text>
            <Badge
              label={plan}
              variant={plan === "elite" ? "danger" : "accent"}
              size="sm"
            />
          </View>
          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
            {timeAgo(post.created_at)}
          </Text>
        </View>
      </View>

      {/* Content */}
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: "400" }}>
        {post.content}
      </Text>

      {/* Agent Card (if attached) */}
      {post.agents && (
        <View
          style={{
            backgroundColor: colors.cardSecondary,
            borderRadius: 12,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderWidth: 1,
            borderColor: colors.cardBorder,
          }}
        >
          <Ionicons name="hardware-chip-outline" size={20} color={Colors.accentLight} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 14 }}>
              {post.agents.name}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              {post.agents.strategy}
            </Text>
          </View>
          <Text style={{ color: Colors.success, fontWeight: "800", fontSize: 16 }}>
            {formatPercent(post.agents.pnl_pct)}
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 20, paddingTop: 4 }}>
        <Pressable
          onPress={onLike}
          style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
        >
          <Ionicons
            name={isLiked ? "heart" : "heart-outline"}
            size={20}
            color={isLiked ? Colors.danger : colors.textTertiary}
          />
          <Text
            style={{
              color: isLiked ? Colors.danger : colors.textTertiary,
              fontSize: 14,
              fontWeight: "600",
            }}
          >
            {post.likes}
          </Text>
        </Pressable>

        <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="chatbubble-outline" size={19} color={colors.textTertiary} />
        </Pressable>

        <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="share-social-outline" size={20} color={colors.textTertiary} />
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable>
          <Ionicons name="bookmark-outline" size={20} color={colors.textTertiary} />
        </Pressable>
      </View>
    </View>
  );
}
