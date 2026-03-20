import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { fetchProfile } from "@/lib/services/profileService";

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  plan: "free" | "pro" | "elite";
  balance: number;
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  activeAgents: number;
  rank: number;
  joinedDate: string;
}

interface UserStore {
  user: User | null;
  hasSeenOnboarding: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  completeOnboarding: () => Promise<void>;
  loadUser: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const useUserStore = create<UserStore>((set, get) => ({
  user: null,
  hasSeenOnboarding: false,
  isLoading: false,

  setUser: (user) => set({ user }),

  completeOnboarding: async () => {
    set({ hasSeenOnboarding: true });
    await AsyncStorage.setItem("@agentvault:onboarded", "1");
  },

  loadUser: async () => {
    set({ isLoading: true });
    try {
      const [seen, { data: { session } }] = await Promise.all([
        AsyncStorage.getItem("@agentvault:onboarded"),
        supabase.auth.getSession(),
      ]);

      const hasSeenOnboarding = seen === "1";

      if (!session?.user) {
        set({ user: null, hasSeenOnboarding, isLoading: false });
        return;
      }

      const authUser = session.user;
      const { data: profile } = await fetchProfile(authUser.id);

      if (profile) {
        set({
          user: {
            id: authUser.id,
            name: profile.display_name ?? authUser.user_metadata?.display_name ?? "Trader",
            email: authUser.email ?? "",
            avatar: profile.avatar ?? authUser.user_metadata?.avatar ?? "🚀",
            plan: profile.plan ?? "free",
            balance: Number(profile.balance ?? 10000),
            totalReturn: 0,
            totalReturnPct: Number(profile.total_return_pct ?? 0),
            winRate: Number(profile.win_rate ?? 0),
            activeAgents: Number(profile.active_agents ?? 0),
            rank: profile.rank ?? 0,
            joinedDate: new Date(profile.created_at).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            }),
          },
          hasSeenOnboarding,
          isLoading: false,
        });
        return;
      }

      // No profile row yet — fall back to auth metadata defaults
      set({
        user: {
          id: authUser.id,
          name: authUser.user_metadata?.display_name ?? "Trader",
          email: authUser.email ?? "",
          avatar: authUser.user_metadata?.avatar ?? "🚀",
          plan: "free",
          balance: 10000,
          totalReturn: 0,
          totalReturnPct: 0,
          winRate: 0,
          activeAgents: 0,
          rank: 0,
          joinedDate: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        },
        hasSeenOnboarding,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  refreshProfile: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data: profile } = await fetchProfile(session.user.id);
    if (!profile) return;
    set((state) => ({
      user: state.user
        ? {
            ...state.user,
            name: profile.display_name ?? state.user.name,
            avatar: profile.avatar ?? state.user.avatar,
            plan: profile.plan ?? state.user.plan,
            balance: Number(profile.balance ?? state.user.balance),
            totalReturnPct: Number(profile.total_return_pct ?? state.user.totalReturnPct),
            winRate: Number(profile.win_rate ?? state.user.winRate),
            activeAgents: Number(profile.active_agents ?? state.user.activeAgents),
            rank: profile.rank ?? state.user.rank,
          }
        : null,
    }));
  },
}));
