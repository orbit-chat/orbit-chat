import type { CapacitorConfig } from "@capacitor/cli";

/**
 * iOS and Android shells (mobile plan M3). They load only the bundled renderer from `dist`
 * (built with `npm run build:mobile`): no `server.url`, so no remote code is ever loaded.
 */
const config: CapacitorConfig = {
  appId: "com.orbit.chat",
  appName: "Orbit",
  webDir: "dist",
  android: {
    // Serve the app from https://localhost (allowed by the server's CORS) and refuse mixed content.
    // Cleartext is also off in the network security config.
    allowMixedContent: false,
    captureInput: true
    // webContentsDebuggingEnabled is left unset: Capacitor then allows WebView debugging only in
    // debuggable (debug) builds, never in a release build.
  },
  ios: {
    // capacitor://localhost; ATS stays on (no NSAllowsArbitraryLoads).
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: true
  },
  server: {
    androidScheme: "https"
  },
  plugins: {
    Keyboard: {
      // The web view shrinks with the keyboard, so the composer stays above it (100dvh layout).
      resize: "native",
      resizeOnFullScreen: true
    },
    PushNotifications: {
      presentationOptions: []
    }
  }
};

export default config;
