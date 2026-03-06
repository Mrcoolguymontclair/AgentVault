import { supabase } from "@/lib/supabase";

export interface SocialPost {
  id: string;
  user_id: string;
  agent_id: string | null;
  content: string;
  likes: number;
  created_at: string;
  profiles: {
    display_name: string;
    avatar: string;
    plan: "free" | "pro" | "elite";
  };
  agents?: {
    name: string;
    strategy: string;
    pnl_pct: number;
  } | null;
  follower_count?: number;
}

export interface SuggestedTrader {
  id: string;
  display_name: string;
  avatar: string;
  plan: "free" | "pro" | "elite";
  total_return_pct: number;
  follower_count: number;
}

export async function fetchFeedPosts(limit = 20) {
  const { data, error } = await supabase
    .from("comments")
    .select(`
      *,
      profiles(display_name, avatar, plan),
      agents(name, strategy, pnl_pct)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data as SocialPost[] | null, error: error?.message ?? null };
}

export async function fetchFollowingPosts(userId: string, limit = 20) {
  // Get list of user IDs this user follows
  const { data: followData } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);

  if (!followData || followData.length === 0) {
    return { data: [] as SocialPost[], error: null };
  }

  const followingIds = followData.map((f) => f.following_id);

  const { data, error } = await supabase
    .from("comments")
    .select(`
      *,
      profiles(display_name, avatar, plan),
      agents(name, strategy, pnl_pct)
    `)
    .in("user_id", followingIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data as SocialPost[] | null, error: error?.message ?? null };
}

export async function fetchSuggestedTraders(userId: string, limit = 10) {
  // Get who the user already follows
  const { data: followData } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId);

  const alreadyFollowing = (followData ?? []).map((f) => f.following_id);
  alreadyFollowing.push(userId); // exclude self

  const { data, error } = await supabase
    .from("leaderboard_view")
    .select("id, display_name, avatar, plan, total_return_pct")
    .not("id", "in", `(${alreadyFollowing.join(",")})`)
    .order("rank", { ascending: true })
    .limit(limit);

  return { data: data as SuggestedTrader[] | null, error: error?.message ?? null };
}

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

export async function likePost(postId: string, currentLikes: number) {
  const { error } = await supabase
    .from("comments")
    .update({ likes: currentLikes + 1 })
    .eq("id", postId);
  return { error: error?.message ?? null };
}

export async function unlikePost(postId: string, currentLikes: number) {
  const { error } = await supabase
    .from("comments")
    .update({ likes: Math.max(0, currentLikes - 1) })
    .eq("id", postId);
  return { error: error?.message ?? null };
}

export async function fetchFollowerCount(userId: string) {
  const { count, error } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("following_id", userId);
  return { count: count ?? 0, error: error?.message ?? null };
}
