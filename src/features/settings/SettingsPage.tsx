import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, IconButton, Kbd, Tooltip, cn } from "../../ui";
import { CloseIcon } from "../../ui/icons";
import { API_BASE } from "../../lib/api";
import { useNavigationStore, type SettingsSection } from "../../stores/navigationStore";
import { installUpdateAction, type AppInfo } from "../../app/useDesktop";
import { switchInterface } from "../../lib/uiPreference";
import { PrivacySection } from "./PrivacySection";
import { NotificationsSection } from "./NotificationsSection";
import { ProfileSection } from "./ProfileSection";

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "privacy", label: "Privacy & security" },
  { id: "notifications", label: "Notifications" },
  { id: "keybinds", label: "Keybinds" },
  { id: "updates", label: "Updates" },
  { id: "about", label: "About" }
];

/**
 * Settings is a page, not an overlay: picking anything in the rail leaves it.
 * Escape and the close button go back to where you were.
 */
export function SettingsPage({
  section,
  appInfo,
  updateStatus
}: {
  section: SettingsSection;
  appInfo: AppInfo;
  updateStatus: UpdaterStatusPayload | null;
}) {
  const openSettings = useNavigationStore((s) => s.openSettings);
  const closeSettings = useNavigationStore((s) => s.closeSettings);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Radix marks Escape as handled when it closes a menu or dialog first.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape in a form field shouldn't throw away what you're typing.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      closeSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings]);

  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Settings sections" className="flex w-[240px] shrink-0 flex-col gap-0.5 border-r border-white/10 bg-orbit-sidebar p-3">
        <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-orbit-muted">Settings</p>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => openSettings(s.id)}
            aria-current={section === s.id ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
              section === s.id ? "bg-white/[0.08] text-orbit-text" : "text-orbit-muted hover:bg-white/[0.04] hover:text-orbit-text"
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="relative min-h-0 flex-1 overflow-y-auto bg-orbit-canvas">
        <div className="absolute right-4 top-4 flex flex-col items-center gap-1">
          <Tooltip content="Close (Esc)" side="left">
            <IconButton label="Close settings" variant="secondary" onClick={closeSettings}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </div>
        <div key={section} className={cn("mx-auto animate-orbit-fade-in px-8 py-10", section === "profile" ? "max-w-4xl" : "max-w-2xl")}>
          {section === "profile" && <ProfileSection />}
          {section === "privacy" && <PrivacySection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "keybinds" && <KeybindsSection />}
          {section === "updates" && <UpdatesSection appInfo={appInfo} status={updateStatus} />}
          {section === "about" && <AboutSection appInfo={appInfo} />}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-bold">{title}</h1>
      {description && <p className="mt-1 text-sm text-orbit-muted">{description}</p>}
    </header>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-white/10 bg-orbit-panel/60 p-5", className)}>{children}</section>;
}


const keybinds: Array<{ action: string; keys: string[] }> = [
  { action: "Open settings", keys: ["Ctrl", ","] },
  { action: "Back / forward", keys: ["Alt", "← / →"] },
  { action: "Attach image", keys: ["Ctrl", "I"] },
  { action: "Open GIF picker", keys: ["Ctrl", "G"] },
  { action: "Open emoji picker", keys: ["Ctrl", "E"] },
  { action: "Focus message input", keys: ["Ctrl", "/"] },
  { action: "Send message", keys: ["Enter"] },
  { action: "Close menu, dialog or settings", keys: ["Esc"] }
];

function KeybindsSection() {
  return (
    <>
      <SectionHeader title="Keybinds" description="On macOS, use Cmd instead of Ctrl." />
      <Card className="p-0">
        <ul className="divide-y divide-white/5">
          {keybinds.map((bind) => (
            <li key={bind.action} className="flex items-center justify-between px-5 py-3 text-sm">
              <span>{bind.action}</span>
              <span className="flex items-center gap-1">
                {bind.keys.map((key, i) => (
                  <span key={key} className="flex items-center gap-1">
                    {i > 0 && <span className="text-[10px] text-orbit-muted">+</span>}
                    <Kbd>{key}</Kbd>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

const statusText: Partial<Record<UpdaterStatus, string>> = {
  checking: "Checking for updates…",
  "not-available": "You're on the latest version.",
  available: "An update is available and downloading.",
  downloading: "Downloading update…",
  downloaded: "An update is ready to install.",
  error: "The last update check failed."
};

function UpdatesSection({ appInfo, status }: { appInfo: AppInfo; status: UpdaterStatusPayload | null }) {
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const install = installUpdateAction(appInfo.isMac);

  const check = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setChecking(true);
    setCheckError(null);
    try {
      const result = await api.checkForUpdates();
      if (!result.ok) setCheckError(result.reason ?? "Update check failed.");
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Update check failed.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <SectionHeader title="Updates" description={`You're running Orbit Chat ${appInfo.version}.`} />
      <Card className="space-y-4">
        {!appInfo.isDesktop ? (
          <p className="text-sm text-orbit-muted">Updates are only available in the desktop app.</p>
        ) : (
          <>
            <p className="text-sm">{status?.message ?? (status ? statusText[status.status] : "Updates are checked automatically.")}</p>
            {typeof status?.progress === "number" && status.status === "downloading" && (
              <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
                <div className="h-full rounded-full bg-orbit-accent transition-[width]" style={{ width: `${status.progress}%` }} />
              </div>
            )}
            {checkError && <Alert tone="danger">{checkError}</Alert>}
            <div className="flex gap-2">
              <Button onClick={check} disabled={checking || status?.status === "checking"}>
                {checking ? "Checking…" : "Check for updates"}
              </Button>
              {status?.status === "downloaded" && (
                <Button variant="primary" onClick={install.run}>
                  {install.label}
                </Button>
              )}
              {appInfo.isMac && status?.status !== "downloaded" && (
                <Button variant="ghost" onClick={() => void window.electronAPI?.openReleasesPage()}>
                  Open releases page
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function AboutSection({ appInfo }: { appInfo: AppInfo }) {
  const rows: Array<[string, string]> = [
    ["Version", appInfo.version],
    ["Platform", appInfo.platform ?? (appInfo.isDesktop ? "unknown" : "browser (dev)")],
    ["Server", API_BASE]
  ];
  return (
    <>
      <SectionHeader title="About" />
      <Card className="p-0">
        <dl className="divide-y divide-white/5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <dt className="text-orbit-muted">{label}</dt>
              <dd className="truncate font-mono text-xs">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <p className="mt-4 text-xs text-orbit-muted">
        Messages and attachments are encrypted on this device before they're sent. The server stores and relays ciphertext only.
      </p>
      <Card className="mt-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Classic interface</p>
          <p className="mt-0.5 text-[11px] text-orbit-muted">Something not working in the new design? Switch back to the previous one. You can return from its title bar.</p>
        </div>
        <Button size="sm" onClick={() => switchInterface("classic")}>
          Use the classic interface
        </Button>
      </Card>
    </>
  );
}
