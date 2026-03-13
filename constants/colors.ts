export const Colors = {
  dark: {
    background: "#000000",
    card: "#111111",
    cardBorder: "#222222",
    cardSecondary: "#161616",
    text: "#FFFFFF",
    textSecondary: "#8A8A8A",
    textTertiary: "#555555",
    tabBar: "#000000",
    tabBarBorder: "#1A1A1A",
    inputBg: "#161616",
    divider: "#1A1A1A",
    skeleton: "#1A1A1A",
    skeletonHighlight: "#252525",
  },
  light: {
    background: "#FFFFFF",
    card: "#FFFFFF",
    cardBorder: "#E5E5E5",
    cardSecondary: "#F5F5F5",
    text: "#000000",
    textSecondary: "#666666",
    textTertiary: "#999999",
    tabBar: "#FFFFFF",
    tabBarBorder: "#E5E5E5",
    inputBg: "#F5F5F5",
    divider: "#E5E5E5",
    skeleton: "#EEEEEE",
    skeletonHighlight: "#E0E0E0",
  },
  // Brand accent — kept as-is, glow treatments removed
  accent: "#6C5CE7",
  accentLight: "#8B7FF5",
  accentDark: "#5A4DD4",
  accentBg: "rgba(108,92,231,0.08)",
  // Robinhood-style sharp trade colors
  success: "#00C805",
  successBg: "rgba(0,200,5,0.10)",
  danger: "#FF3B30",
  dangerBg: "rgba(255,59,48,0.10)",
  // Supporting
  warning: "#FF9500",
  warningBg: "rgba(255,149,0,0.10)",
  gold: "#FFD700",
  silver: "#8E8E93",
  bronze: "#CD7F32",
};

export type ThemeColors = typeof Colors.dark & {
  accent: string;
  accentLight: string;
  accentDark: string;
  accentBg: string;
  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  gold: string;
  silver: string;
  bronze: string;
};
