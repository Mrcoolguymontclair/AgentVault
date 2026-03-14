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
          dark: "#000000",
          light: "#FFFFFF",
        },
        card: {
          dark: "#111111",
          light: "#FFFFFF",
        },
        border: {
          dark: "#222222",
          light: "#E5E5E5",
        },
        accent: {
          DEFAULT: "#0B5C36",
          light: "#22C55E",
          dark: "#084428",
        },
        success: {
          DEFAULT: "#00C805",
          bg: "rgba(0,200,5,0.10)",
        },
        danger: {
          DEFAULT: "#FF3B30",
          bg: "rgba(255,59,48,0.10)",
        },
        warning: {
          DEFAULT: "#FF9500",
          bg: "rgba(255,149,0,0.10)",
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
