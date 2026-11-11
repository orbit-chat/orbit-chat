import { defineConfig, loadEnv, type Plugin } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

/** Origin of a configured URL, or null if it's missing or malformed. */
function originOf(url: string | undefined) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * Strict CSP for the iOS/Android shells (mobile plan M3): only the bundled app, the configured
 * API/socket/media origins and Giphy. Decrypted attachments are `blob:` URLs. libsodium needs
 * `wasm-unsafe-eval`; inline styles come from React style props and Radix positioning.
 */
function mobileCsp(env: Record<string, string>): Plugin {
  const api = originOf(env.VITE_API_URL);
  const socket = originOf(env.VITE_SOCKET_URL);
  const media = originOf(env.VITE_MEDIA_ORIGIN);
  const wss = socket?.replace(/^https:/, "wss:") ?? null;
  const connect = ["'self'", api, socket, wss, media, "https://api.giphy.com"].filter(Boolean).join(" ");
  const images = ["'self'", "data:", "blob:", api, media, "https://media.giphy.com", "https://*.giphy.com"].filter(Boolean).join(" ");
  const policy = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images}`,
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join("; ");
  return {
    name: "orbit-mobile-csp",
    transformIndexHtml: (html) => html.replace("<head>", `<head>
    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
  };
}

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      // libsodium-wrappers(-sumo)@0.7.16 currently publishes an ESM entry that imports
      // a sibling file (./libsodium-sumo.mjs) that is not included in the package.
      // Force the CommonJS build which correctly pulls in the `libsodium-sumo` dep.
      // Use an absolute path to bypass the package `exports` map restrictions.
      "libsodium-wrappers-sumo": resolve(
        resolve(fileURLToPath(new URL(".", import.meta.url))),
        "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js"
      )
    }
  },
  plugins: [
    react(),
    // `*-web` modes serve only the renderer in a browser (no Electron window), for UI work and previews.
    // window.electronAPI is undefined there, so desktop-only controls do nothing.
    // `mobile` builds the renderer for the Capacitor shells (`npm run build:mobile`).
    ...(mode === "mobile" ? [mobileCsp(loadEnv(mode, process.cwd(), "VITE_"))] : []),
    ...(mode.endsWith("-web") || mode === "mobile"
      ? []
      : [
          electron({
            main: {
              entry: "electron/main.ts"
            },
            preload: {
              input: "electron/preload.ts"
            }
          })
        ])
  ]
}));
