import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      colors: {
        bg: "#FAF8F5",
        "bg-dark": "#0F0C0A",
        ink: "#1A0F08",
        orange: { DEFAULT: "#E8754A", light: "#FFB085", muted: "rgba(232,117,74,0.1)" },
        lavender: { DEFAULT: "#7C6FE0", muted: "rgba(124,111,224,0.1)" },
      },
      borderRadius: {
        DEFAULT: "14px",
        full: "9999px",
        xl: "20px",
        "2xl": "28px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
