import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      // libsodium-wrappers@0.7.16 currently publishes an ESM entry that imports
      // a sibling file (./libsodium.mjs) that is not included in the package.
      // Force the CommonJS build which correctly pulls in the `libsodium` dep.
      // Use an absolute path to bypass the package `exports` map restrictions.
      "libsodium-wrappers": resolve(
        resolve(fileURLToPath(new URL(".", import.meta.url))),
        "node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js"
      )
    }
  },
  plugins: [
    react(),
    // `*-web` modes serve only the renderer in a browser (no Electron window), for UI work and previews.
    // window.electronAPI is undefined there, so desktop-only controls do nothing.
    ...(mode.endsWith("-web")
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
