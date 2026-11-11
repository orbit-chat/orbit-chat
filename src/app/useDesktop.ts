import { useEffect, useState } from "react";
import { getPlatform } from "../platform";

export type AppInfo = { version: string; platform: string | null; isMac: boolean; isDesktop: boolean };

/** App version and OS from the shell (placeholders in a plain browser). */
export function useAppInfo(): AppInfo {
  const [info, setInfo] = useState<{ version: string; os: string | null }>({ version: "dev", os: null });

  useEffect(() => {
    let cancelled = false;
    getPlatform()
      .appInfo()
      .then((next) => !cancelled && setInfo(next))
      .catch(() => !cancelled && setInfo({ version: "unknown", os: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  return { version: info.version, platform: info.os, isMac: info.os === "darwin", isDesktop: getPlatform().kind === "desktop" };
}

/** Latest auto-updater event, or null before the first one (always null without an updater). */
export function useUpdaterStatus(): UpdaterStatusPayload | null {
  const [status, setStatus] = useState<UpdaterStatusPayload | null>(null);
  useEffect(() => getPlatform().updater?.onStatus(setStatus), []);
  return status;
}

/**
 * macOS builds aren't auto-installed: the update is downloaded from GitHub Releases instead.
 * Returns the button label and action for a downloaded update.
 */
export function installUpdateAction(isMac: boolean) {
  const updater = getPlatform().updater;
  return isMac
    ? { label: "Download update", run: () => void updater?.openReleasesPage() }
    : { label: "Restart and install", run: () => void updater?.install() };
}
