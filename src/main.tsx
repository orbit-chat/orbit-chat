import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import { installDevLogger } from "./lib/devLogger";
import { chosenInterface } from "./lib/uiPreference";

// Install global error/warn capture (no-ops in production builds)
installDevLogger();

const queryClient = new QueryClient();

// `mobile-local` is the same phone build, pointed at a server on this computer (see serverConfig.ts).
const MOBILE_BUILD = import.meta.env.MODE === "mobile" || import.meta.env.MODE === "mobile-local";

async function start() {
  // The iOS/Android shells install their platform (Keychain/Keystore, camera, privacy screen)
  // before anything reads a secret. Only the mobile build contains this code.
  if (MOBILE_BUILD) {
    const { capacitorPlatform, isNativeShell } = await import("./platform/capacitor");
    const { setPlatform } = await import("./platform");
    if (isNativeShell()) setPlatform(await capacitorPlatform());
  }

  // The rebuilt UI (src/app) is the default. The classic App stays available as a fallback on
  // desktop (Settings → About → "Use the classic interface") until it's removed; phones never get it.
  const Root = !MOBILE_BUILD && chosenInterface() === "classic" ? lazy(() => import("./App")) : lazy(() => import("./app/NewApp"));

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <Root />
        </Suspense>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

void start();
