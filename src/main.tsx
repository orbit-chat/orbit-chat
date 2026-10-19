import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import { installDevLogger } from "./lib/devLogger";
import { chosenInterface } from "./lib/uiPreference";

// Install global error/warn capture (no-ops in production builds)
installDevLogger();

const queryClient = new QueryClient();

// The rebuilt UI (src/app) is the default. The classic App stays available as a fallback
// (Settings → About → "Use the classic interface") until it's removed.
const Root = chosenInterface() === "classic" ? lazy(() => import("./App")) : lazy(() => import("./app/NewApp"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>
);
