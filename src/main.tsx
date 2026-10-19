import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles.css";
import { installDevLogger } from "./lib/devLogger";

// Install global error/warn capture (no-ops in production builds)
installDevLogger();

const queryClient = new QueryClient();

// The rebuilt UI (src/app) runs side by side with the old one until it reaches parity.
// `npm run dev:new` sets VITE_NEW_UI=1; everything else still gets the old App.
const Root = import.meta.env.VITE_NEW_UI === "1" ? lazy(() => import("./app/NewApp")) : lazy(() => import("./App"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>
);
