import type { Config } from "tailwindcss";

/** Reads an `R G B` channel triple from a CSS variable so opacity modifiers (`/40`) keep working. */
const token = (name: string) => `rgb(var(--orbit-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        orbit: {
          // Original palette — values unchanged, now backed by tokens in styles.css.
          bg: token("bg"),
          panel: token("panel"),
          panelAlt: token("panel-alt"),
          text: token("text"),
          muted: token("muted"),
          accent: token("accent"),
          accentBright: token("accent-bright"),
          danger: token("danger"),
          warning: token("warning"),
          // Surface scale, darkest to lightest. Replaces the hex values hard-coded in the old UI.
          chrome: token("chrome"),
          base: token("base"),
          canvas: token("canvas"),
          sidebar: token("sidebar"),
          raised: token("raised"),
          overlay: token("overlay"),
          dialog: token("dialog"),
          bubble: token("bubble"),
          hover: token("hover")
        }
      },
      zIndex: {
        // One stacking scale for everything that floats. New UI code uses these names only.
        popover: "50",
        dialog: "60",
        menu: "70",
        toast: "80",
        tooltip: "90"
      },
      keyframes: {
        "orbit-fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "orbit-fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
        "orbit-pop-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" }
        },
        "orbit-rise": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        "orbit-pop-out": {
          from: { opacity: "1", transform: "scale(1)" },
          to: { opacity: "0", transform: "scale(0.96)" }
        }
      },
      animation: {
        "orbit-fade-in": "orbit-fade-in 120ms ease-out",
        "orbit-fade-out": "orbit-fade-out 90ms ease-in",
        "orbit-pop-in": "orbit-pop-in 120ms cubic-bezier(0.16, 1, 0.3, 1)",
        "orbit-pop-out": "orbit-pop-out 90ms ease-in",
        "orbit-rise": "orbit-rise 180ms cubic-bezier(0.16, 1, 0.3, 1)"
      }
    }
  },
  plugins: []
};

export default config;
