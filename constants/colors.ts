export const Colors = {
  dark: {
    background: "#0F1117",
    card: "#1A1D26",
    cardBorder: "#2A2D3A",
    cardSecondary: "#21253A",
    text: "#FFFFFF",
    textSecondary: "#8B8FA8",
    textTertiary: "#5A5F76",
    tabBar: "#13151F",
    tabBarBorder: "#1F2233",
    inputBg: "#1F2233",
    divider: "#2A2D3A",
    skeleton: "#21253A",
    skeletonHighlight: "#2E3347",
  },
  light: {
    background: "#F7F8FA",
    card: "#FFFFFF",
    cardBorder: "#E8EAF0",
    cardSecondary: "#F0F2F8",
    text: "#0F1117",
    textSecondary: "#5A5F76",
    textTertiary: "#8B8FA8",
    tabBar: "#FFFFFF",
    tabBarBorder: "#E8EAF0",
    inputBg: "#F0F2F8",
    divider: "#E8EAF0",
    skeleton: "#E8EAF0",
    skeletonHighlight: "#D8DBE6",
  },
  accent: "#6C5CE7",
  accentLight: "#8B7FF5",
  accentDark: "#5A4DD4",
  accentBg: "rgba(108,92,231,0.12)",
  success: "#00D68F",
  successBg: "rgba(0,214,143,0.12)",
  danger: "#FF6B6B",
  dangerBg: "rgba(255,107,107,0.12)",
  warning: "#FFA94D",
  warningBg: "rgba(255,169,77,0.12)",
  gold: "#FFD43B",
  silver: "#ADB5BD",
  bronze: "#FD7E14",
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
