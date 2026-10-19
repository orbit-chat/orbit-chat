import { useEffect, useState } from "react";

export type AppInfo = { version: string; platform: string | null; isMac: boolean; isDesktop: boolean };

/** App version and OS from the Electron main process (placeholders in a plain browser). */
export function useAppInfo(): AppInfo {
  const [version, setVersion] = useState("dev");
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    api.getVersion().then(setVersion).catch(() => setVersion("unknown"));
    api.getPlatform().then(setPlatform).catch(() => setPlatform(null));
  }, []);

  return { version, platform, isMac: platform === "darwin", isDesktop: Boolean(window.electronAPI) };
}

/** Latest auto-updater event, or null before the first one. */
export function useUpdaterStatus(): UpdaterStatusPayload | null {
  const [status, setStatus] = useState<UpdaterStatusPayload | null>(null);
  useEffect(() => window.electronAPI?.onUpdaterStatus(setStatus), []);
  return status;
}

/**
 * macOS builds aren't auto-installed: the update is downloaded from GitHub Releases instead.
 * Returns the button label and action for a downloaded update.
 */
export function installUpdateAction(isMac: boolean) {
  return isMac
    ? { label: "Download update", run: () => void window.electronAPI?.openReleasesPage() }
    : { label: "Restart and install", run: () => void window.electronAPI?.quitAndInstallUpdate() };
}
