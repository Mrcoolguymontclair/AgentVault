import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Theme = "dark" | "light";

interface ThemeStore {
  theme: Theme;
  isLoaded: boolean;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => void;
  loadTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: "dark",
  isLoaded: false,
  setTheme: async (theme) => {
    set({ theme });
    await AsyncStorage.setItem("@agentvault:theme", theme);
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },
  loadTheme: async () => {
    try {
      const stored = await AsyncStorage.getItem("@agentvault:theme");
      if (stored === "dark" || stored === "light") {
        set({ theme: stored, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },
}));
