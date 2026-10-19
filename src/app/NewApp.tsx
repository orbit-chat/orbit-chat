import "./app.css";
import { TooltipProvider } from "../ui";
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

/** Root of the rebuilt UI: window chrome, then sign-in, one-time recovery codes, or the app. */
export default function NewApp() {
  const appInfo = useAppInfo();
  const updateStatus = useUpdaterStatus();
  useSessionLifecycle();

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-orbit-base text-orbit-text">
        <TitleBar />
        <UpdateBanner status={updateStatus} isMac={appInfo.isMac} />
        {/* Inside the window chrome, so a crash still leaves the title bar's window controls. */}
        <ErrorBoundary>
          <Screen appInfo={appInfo} updateStatus={updateStatus} />
        </ErrorBoundary>
      </div>
    </TooltipProvider>
  );
}

function Screen({ appInfo, updateStatus }: Parameters<typeof AppShell>[0]) {
  const user = useAuthStore((s) => s.user);
  const recoveryCodes = useAuthStore((s) => s.pendingRecoveryCodes);

  // Dev-only primitives gallery: open the app with #gallery.
  if (import.meta.env.DEV && window.location.hash === "#gallery") return <DevGallery />;
  if (!user) return <AuthScreen />;
  if (recoveryCodes?.length) return <RecoveryCodesScreen codes={recoveryCodes} />;
  return <AppShell appInfo={appInfo} updateStatus={updateStatus} />;
}
