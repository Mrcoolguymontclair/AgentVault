import { useThemeStore } from "@/store/themeStore";
import { Colors, type ThemeColors } from "@/constants/colors";

export function useTheme() {
  const { theme, toggleTheme, setTheme } = useThemeStore();
  const isDark = theme === "dark";
  const base = isDark ? Colors.dark : Colors.light;

  const colors: ThemeColors = {
    ...base,
    accent: Colors.accent,
    accentLight: Colors.accentLight,
    accentDark: Colors.accentDark,
    accentBg: Colors.accentBg,
    success: Colors.success,
    successBg: Colors.successBg,
    danger: Colors.danger,
    dangerBg: Colors.dangerBg,
    warning: Colors.warning,
    warningBg: Colors.warningBg,
    gold: Colors.gold,
    silver: Colors.silver,
    bronze: Colors.bronze,
  };

  return { theme, isDark, colors, toggleTheme, setTheme };
}
