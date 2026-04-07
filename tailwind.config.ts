import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        orbit: {
          bg: "#0d1117",
          panel: "#111827",
          panelAlt: "#0f172a",
          text: "#e5e7eb",
          muted: "#94a3b8",
          accent: "#2dd4bf",
          danger: "#fb7185"
        }
      }
    }
  },
  plugins: []
};

export default config;
