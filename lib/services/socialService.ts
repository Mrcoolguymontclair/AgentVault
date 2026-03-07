import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ─── Types ─────────────────────────────────────────────────────

export interface FeedTrade {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_strategy: string;
  owner_user_id: string;
  owner_display_name: string;
  owner_avatar: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  pnl: number;
  executed_at: string;
}

export interface Comment {
  id: string;
  user_id: string;
  agent_id: string | null;
  content: string;
  likes: number;
  created_at: string;
  profiles: {
    display_name: string;
    avatar: string;
  } | null;
}

export interface TraderProfile {
  id: string;
  display_name: string;
  avatar: string;
  plan: "free" | "pro" | "elite";
  win_rate: number;
  total_return_pct: number;
  active_agents: number;
}

export interface SuggestedTrader {
  id: string;
  display_name: string;
  avatar: string;
  plan: "free" | "pro" | "elite";
  total_return_pct: number;
  follower_count: number;
}

// ─── Feed ──────────────────────────────────────────────────────

type RawFeedTrade = {
  id: string;
  agent_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number | string;
  price: number | string;
  pnl: number | string;
  executed_at: string;
  agents: {
    name: string;
    strategy: string;
    user_id: string;
    profiles: { display_name: string; avatar: string } | null;
  } | null;
};

function mapRawTrade(t: RawFeedTrade): FeedTrade {
  return {
    id: t.id,
    agent_id: t.agent_id,
    agent_name: t.agents?.name ?? "Unknown Agent",
    agent_strategy: t.agents?.strategy ?? "",
    owner_user_id: t.agents?.user_id ?? "",
    owner_display_name: t.agents?.profiles?.display_name ?? "Trader",
    owner_avatar: t.agents?.profiles?.avatar ?? "🚀",
    symbol: t.symbol,
    side: t.side,
    quantity: Number(t.quantity),
    price: Number(t.price),
    pnl: Number(t.pnl),
    executed_at: t.executed_at,
  };
}

export async function fetchTradeFeed(
  followedAgentIds: string[],
  limit = 40
): Promise<{ data: FeedTrade[]; error: string | null }> {
  if (followedAgentIds.length === 0) return { data: [], error: null };

  const { data, error } = await supabase
    .from("trades")
    .select("*, agents(name, strategy, user_id, profiles(display_name, avatar))")
    .in("agent_id", followedAgentIds)
    .order("executed_at", { ascending: false })
    .limit(limit);

  if (error) return { data: [], error: error.message };
  return { data: ((data as RawFeedTrade[]) ?? []).map(mapRawTrade), error: null };
}

/** Subscribe to all new trades and filter client-side by followed agent IDs. */
export function subscribeToFeedTrades(
  followedAgentIds: Set<string>,
  onNew: (trade: FeedTrade) => void
): RealtimeChannel {
  return supabase
    .channel("social-feed-trades")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "trades" },
      async (payload) => {
        const raw = payload.new as { agent_id: string; id: string };
        if (!followedAgentIds.has(raw.agent_id)) return;

        // Hydrate with agent + profile info
        const { data } = await supabase
          .from("trades")
          .select("*, agents(name, strategy, user_id, profiles(display_name, avatar))")
          .eq("id", raw.id)
          .single();

        if (data) onNew(mapRawTrade(data as RawFeedTrade));
      }
    )
    .subscribe();
}

// ─── Comments ──────────────────────────────────────────────────

export async function fetchComments(agentId: string, limit = 50) {
  const { data, error } = await supabase
    .from("comments")
    .select("*, profiles(display_name, avatar)")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return { data: (data as Comment[] | null) ?? [], error: error?.message ?? null };
}

export async function postComment(
  userId: string,
  agentId: string,
  content: string
): Promise<{ data: Comment | null; error: string | null }> {
  const { data, error } = await supabase
    .from("comments")
    .insert({ user_id: userId, agent_id: agentId, content: content.trim() })
    .select("*, profiles(display_name, avatar)")
    .single();

  return { data: data as Comment | null, error: error?.message ?? null };
}

export async function deleteComment(commentId: string) {
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  return { error: error?.message ?? null };
}

// ─── Trader Profile ────────────────────────────────────────────

export async function fetchTraderProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar, plan, win_rate, total_return_pct, active_agents")
    .eq("id", userId)
    .single();

  return { data: data as TraderProfile | null, error: error?.message ?? null };
}

export async function fetchTraderPublicAgents(userId: string) {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .eq("is_private", false)
    .in("status", ["active", "paused", "backtesting"])
    .order("pnl_pct", { ascending: false });

  return { data: data ?? [], error: error?.message ?? null };
}

// ─── Discover ──────────────────────────────────────────────────

export async function fetchSuggestedAgentOwners(
  currentUserId: string,
  limit = 10
): Promise<SuggestedTrader[]> {
  // Get followed agent IDs for current user
  const { data: followData } = await supabase
    .from("agent_follows")
    .select("agent_id")
    .eq("follower_id", currentUserId);

  const followedIds = (followData ?? []).map((f: { agent_id: string }) => f.agent_id);

  // Get top agents from leaderboard not owned by current user
  const { data } = await supabase
    .from("agent_leaderboard")
    .select("user_id, display_name, avatar, pnl_pct, followers_count")
    .neq("user_id", currentUserId)
    .order("rank", { ascending: true })
    .limit(limit * 3); // fetch extra to dedupe by user

  if (!data) return [];

  // Deduplicate by user_id, take top N unique traders
  const seen = new Set<string>();
  const traders: SuggestedTrader[] = [];
  for (const row of data as any[]) {
    if (seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    traders.push({
      id: row.user_id,
      display_name: row.display_name,
      avatar: row.avatar,
      plan: "free",
      total_return_pct: Number(row.pnl_pct),
      follower_count: Number(row.followers_count ?? 0),
    });
    if (traders.length >= limit) break;
  }
  return traders;
}

// ─── Legacy (kept for backward compatibility) ─────────────────

export async function followUser(followerId: string, followingId: string) {
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: followerId, following_id: followingId });
  return { error: error?.message ?? null };
}

export async function unfollowUser(followerId: string, followingId: string) {
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("following_id", followingId);
  return { error: error?.message ?? null };
}
