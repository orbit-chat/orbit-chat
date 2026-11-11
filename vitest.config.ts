import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the alias in vite.config.ts: libsodium-wrappers(-sumo)@0.7.16 publishes an
      // ESM entry that imports a sibling ./libsodium-sumo.mjs which is not shipped in the
      // package. Force the CommonJS build so tests resolve the same module the app does.
      "libsodium-wrappers-sumo": resolve(
        rootDir,
        "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js"
      )
    }
  },
  test: {
    // Default to node; store tests opt into jsdom with a
    // `// @vitest-environment jsdom` pragma at the top of the file.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "electron/**/*.test.ts"]
  }
});
