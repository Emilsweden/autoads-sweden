import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#FAF7F2",
        sage: {
          DEFAULT: "#8A9B6E",
          dark: "#6F7F57",
          light: "#EDF0E6",
        },
        terracotta: {
          DEFAULT: "#C4704B",
          dark: "#A85C3B",
          light: "#F6E9E2",
        },
        ink: "#2B2A26",
        stone: "#6E6A63",
      },
      fontFamily: {
        serif: ["var(--font-playfair)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
