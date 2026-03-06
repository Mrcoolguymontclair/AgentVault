/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./hooks/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: {
          dark: "#0F1117",
          light: "#F7F8FA",
        },
        card: {
          dark: "#1A1D26",
          light: "#FFFFFF",
        },
        border: {
          dark: "#2A2D3A",
          light: "#E8EAF0",
        },
        accent: {
          DEFAULT: "#6C5CE7",
          light: "#8B7FF5",
          dark: "#5A4DD4",
        },
        success: {
          DEFAULT: "#00D68F",
          bg: "rgba(0,214,143,0.12)",
        },
        danger: {
          DEFAULT: "#FF6B6B",
          bg: "rgba(255,107,107,0.12)",
        },
        warning: {
          DEFAULT: "#FFA94D",
          bg: "rgba(255,169,77,0.12)",
        },
      },
      borderRadius: {
        "2xl": "16px",
        "3xl": "24px",
      },
      spacing: {
        4.5: "18px",
        18: "72px",
      },
    },
  },
  plugins: [],
};
