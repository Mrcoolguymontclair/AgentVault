import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/store/authStore";
import { Colors } from "@/constants/colors";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency, formatPercent } from "@/utils/format";
import { STRATEGIES } from "@/constants/strategies";
import type { StrategyId } from "@/constants/strategies";
import {
  fetchTraderProfile,
  fetchTraderPublicAgents,
  type TraderProfile,
} from "@/lib/services/socialService";
import {
  fetchFollowedAgentIds,
  followAgent,
  unfollowAgent,
} from "@/lib/services/leaderboardService";

export default function TraderProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { user: authUser } = useAuthStore();

  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [followedAgentIds, setFollowedAgentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    async function load() {
      const [profileRes, agentsRes] = await Promise.all([
        fetchTraderProfile(id),
        fetchTraderPublicAgents(id),
      ]);
      setProfile(profileRes.data);
      setAgents(agentsRes.data);

      if (authUser?.id) {
        const followed = await fetchFollowedAgentIds(authUser.id);
        setFollowedAgentIds(followed);
      }
      setLoading(false);
    }
    load();
  }, [id, authUser?.id]);

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

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Ionicons name="person-outline" size={48} color={colors.textTertiary} />
          <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Trader not found</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: Colors.accentLight, fontSize: 14, fontWeight: "600" }}>
              Go Back
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isOwnProfile = authUser?.id === id;

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
        <Text
          style={{
            flex: 1,
            color: colors.text,
            fontSize: 18,
            fontWeight: "800",
            letterSpacing: -0.4,
          }}
          numberOfLines={1}
        >
          Trader Profile
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 20 }}
      >
        {/* Profile Hero */}
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            padding: 20,
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* Avatar */}
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: Colors.accentBg,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: Colors.accent + "44",
            }}
          >
            <Text style={{ fontSize: 40 }}>{profile.avatar}</Text>
          </View>

          <View style={{ alignItems: "center", gap: 6 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 22,
                fontWeight: "800",
                letterSpacing: -0.5,
              }}
            >
              {profile.display_name}
            </Text>
            <Badge
              label={profile.plan}
              variant={
                profile.plan === "elite"
                  ? "danger"
                  : profile.plan === "pro"
                  ? "accent"
                  : "neutral"
              }
              size="md"
            />
          </View>

          {/* Stats */}
          <View
            style={{
              flexDirection: "row",
              gap: 0,
              width: "100%",
              borderTopWidth: 1,
              borderTopColor: colors.divider,
              paddingTop: 16,
            }}
          >
            {[
              {
                label: "Agents",
                value: `${profile.active_agents}`,
                icon: "hardware-chip-outline",
              },
              {
                label: "Return",
                value: formatPercent(profile.total_return_pct),
                icon: "trending-up-outline",
                positive: profile.total_return_pct >= 0,
              },
              {
                label: "Win Rate",
                value: `${profile.win_rate}%`,
                icon: "trophy-outline",
              },
            ].map((stat, i, arr) => (
              <View
                key={stat.label}
                style={{
                  flex: 1,
                  alignItems: "center",
                  gap: 4,
                  borderRightWidth: i < arr.length - 1 ? 1 : 0,
                  borderRightColor: colors.divider,
                }}
              >
                <Ionicons name={stat.icon as any} size={16} color={colors.textSecondary} />
                <Text
                  style={{
                    color:
                      "positive" in stat
                        ? stat.positive
                          ? Colors.success
                          : Colors.danger
                        : colors.text,
                    fontWeight: "800",
                    fontSize: 16,
                  }}
                >
                  {stat.value}
                </Text>
                <Text
                  style={{
                    color: colors.textTertiary,
                    fontSize: 10,
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Public Agents */}
        <View style={{ gap: 12 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: 17,
              fontWeight: "700",
            }}
          >
            Public Agents{" "}
            <Text style={{ color: colors.textTertiary, fontWeight: "500" }}>
              ({agents.length})
            </Text>
          </Text>

          {agents.length === 0 ? (
            <EmptyState
              icon="hardware-chip-outline"
              title="No Public Agents"
              description="This trader hasn't made any agents public yet."
            />
          ) : (
            agents.map((agent) => {
              const stratDef = STRATEGIES.find(
                (s) => s.id === (agent.strategy as StrategyId)
              );
              const isFollowing = followedAgentIds.has(agent.id);
              const isPositive = Number(agent.pnl_pct) >= 0;

              return (
                <Pressable
                  key={agent.id}
                  onPress={() => router.push(`/agent/${agent.id}`)}
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    padding: 14,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  {/* Icon */}
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: Colors.accentBg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 24 }}>{stratDef?.icon ?? "🤖"}</Text>
                  </View>

                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={{
                        color: colors.text,
                        fontWeight: "700",
                        fontSize: 14,
                      }}
                      numberOfLines={1}
                    >
                      {agent.name}
                    </Text>
                    <Text
                      style={{ color: colors.textSecondary, fontSize: 12 }}
                    >
                      {stratDef?.name ?? agent.strategy} ·{" "}
                      {agent.trades_count} trades
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
                      {formatPercent(Number(agent.pnl_pct))}
                    </Text>
                    {!isOwnProfile && (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleFollow(agent.id);
                        }}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 8,
                          backgroundColor: isFollowing
                            ? Colors.accentBg
                            : colors.cardSecondary,
                          borderWidth: 1,
                          borderColor: isFollowing
                            ? Colors.accent
                            : colors.cardBorder,
                        }}
                      >
                        <Text
                          style={{
                            color: isFollowing
                              ? Colors.accentLight
                              : colors.textSecondary,
                            fontWeight: "700",
                            fontSize: 11,
                          }}
                        >
                          {isFollowing ? "Following" : "Follow"}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
