import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
}

const MOCK_USER: User = {
  id: "1",
  name: "Owen Showalter",
  email: "owen@agentvault.com",
  plan: "pro",
  balance: 25430.82,
  totalReturn: 3240.5,
  totalReturnPct: 14.6,
  winRate: 68.4,
  activeAgents: 3,
  rank: 47,
  joinedDate: "Jan 2025",
};

export const useUserStore = create<UserStore>((set) => ({
  user: MOCK_USER,
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
      const seen = await AsyncStorage.getItem("@agentvault:onboarded");
      set({ hasSeenOnboarding: seen === "1", isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));
