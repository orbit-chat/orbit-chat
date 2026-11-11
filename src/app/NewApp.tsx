import "./app.css";
import { useEffect } from "react";
import { TooltipProvider, cn } from "../ui";
import { useAuthStore } from "../stores/authStore";
import { AuthScreen } from "../features/auth/AuthScreen";
import { RecoveryCodesScreen } from "../features/auth/RecoveryCodesScreen";
import { AppShell } from "./AppShell";
import { ErrorBoundary } from "./ErrorBoundary";
import { TitleBar } from "./TitleBar";
import { UpdateBanner } from "./UpdateBanner";
import { useAppInfo, useUpdaterStatus } from "./useDesktop";
import { useSessionLifecycle } from "./useSessionLifecycle";
import { DevGallery } from "./dev/DevGallery";
import DevOverlay from "../components/DevOverlay";
import { isMobile } from "../platform";
import { insecureServerProblem } from "../lib/serverConfig";
import { AppLockGate } from "../features/security/appLock";

/** Root of the rebuilt UI: window chrome, then sign-in, one-time recovery codes, or the app. */
export default function NewApp() {
  const appInfo = useAppInfo();
  const updateStatus = useUpdaterStatus();
  useSessionLifecycle();
  // Phones stay signed in across launches (mobile plan M3); desktop signs in each time.
  useEffect(() => {
    void useAuthStore.getState().restoreSession();
  }, []);

  return (
    <TooltipProvider>
      {/* dvh tracks the on-screen keyboard and browser chrome on phones; the top inset clears the notch. */}
      <div className={cn("flex h-[100dvh] flex-col overflow-hidden bg-orbit-base text-orbit-text", isMobile() && "pt-[env(safe-area-inset-top)]")}>
        {!isMobile() && <TitleBar />}
        <UpdateBanner status={updateStatus} isMac={appInfo.isMac} />
        {/* Inside the window chrome, so a crash still leaves the title bar's window controls. */}
        <ErrorBoundary>
          <AppLockGate>
            <Screen appInfo={appInfo} updateStatus={updateStatus} />
          </AppLockGate>
        </ErrorBoundary>
        {/* Dev builds only: the in-app log viewer (Ctrl+Shift+F12), shared with the old UI. */}
        {import.meta.env.DEV && <DevOverlay />}
      </div>
    </TooltipProvider>
  );
}

function Screen({ appInfo, updateStatus }: Parameters<typeof AppShell>[0]) {
  const user = useAuthStore((s) => s.user);
  const recoveryCodes = useAuthStore((s) => s.pendingRecoveryCodes);

  // Dev-only primitives gallery: open the app with #gallery.
  if (import.meta.env.DEV && window.location.hash === "#gallery") return <DevGallery />;
  const insecure = insecureServerProblem(isMobile());
  if (insecure) {
    return (
      <div role="alert" className="flex flex-1 items-center justify-center p-8 text-center text-sm text-orbit-muted">
        {insecure}
      </div>
    );
  }
  if (!user) return <AuthScreen />;
  if (recoveryCodes?.length) return <RecoveryCodesScreen codes={recoveryCodes} />;
  return <AppShell appInfo={appInfo} updateStatus={updateStatus} />;
}
