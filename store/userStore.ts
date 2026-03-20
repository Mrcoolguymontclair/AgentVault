import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchProfile, type DbProfile } from "@/lib/services/profileService";

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
  error: string | null;
  setUser: (user: User | null) => void;
  completeOnboarding: () => Promise<void>;
  loadUser: (userId?: string, email?: string) => Promise<void>;
  clearError: () => void;
}

function dbProfileToUser(profile: DbProfile, email?: string): User {
  const createdAt = new Date(profile.created_at);
  const joinedDate = createdAt.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  return {
    id: profile.id,
    name: profile.display_name || "Trader",
    email: email || "",
    avatar: profile.avatar || undefined,
    plan: profile.plan,
    balance: Number(profile.balance),
    totalReturn: 0, // Computed from portfolio snapshots, not stored on profile
    totalReturnPct: Number(profile.total_return_pct),
    winRate: Number(profile.win_rate),
    activeAgents: profile.active_agents,
    rank: profile.rank ?? 0,
    joinedDate,
  };
}

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  hasSeenOnboarding: false,
  isLoading: false,
  error: null,

  setUser: (user) => set({ user }),
  clearError: () => set({ error: null }),

  completeOnboarding: async () => {
    set({ hasSeenOnboarding: true });
    await AsyncStorage.setItem("@agentvault:onboarded", "1");
  },

  loadUser: async (userId?: string, email?: string) => {
    set({ isLoading: true, error: null });
    try {
      const seen = await AsyncStorage.getItem("@agentvault:onboarded");
      const hasSeenOnboarding = seen === "1";

      if (userId) {
        const { data: profile, error } = await fetchProfile(userId);
        if (error) {
          console.error("[userStore] Failed to load profile:", error);
          set({ hasSeenOnboarding, isLoading: false, error });
          return;
        }
        if (profile) {
          set({
            user: dbProfileToUser(profile, email),
            hasSeenOnboarding,
            isLoading: false,
          });
          return;
        }
      }

      // No userId or no profile found — user is null until profile is created
      set({ hasSeenOnboarding, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load user";
      console.error("[userStore] loadUser error:", message);
      set({ isLoading: false, error: message });
    }
  },
}));
