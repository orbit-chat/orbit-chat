import { createDesktopSecureStore } from "./desktopSecureStore";
import type { NotificationPermissionState, Platform, SecureStore, Updater } from "./index";

/**
 * Plain localStorage. NOT encrypted at rest: this is where desktop has always kept the device
 * private key, so existing installs keep working. Mobile shells must replace it with the
 * Keychain / Android Keystore, and desktop should move to Electron safeStorage.
 */
export const localStorageStore: SecureStore = {
  get: async (key) => localStorage.getItem(key),
  set: async (key, value) => localStorage.setItem(key, value),
  remove: async (key) => localStorage.removeItem(key)
};

const notificationsAvailable = () => typeof window !== "undefined" && "Notification" in window;

/** Saves through an `<a download>` click: Electron shows a save dialog, browsers download. */
async function downloadViaAnchor(name: string, data: Blob | string) {
  const url = typeof data === "string" ? data : URL.createObjectURL(data);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.click();
  } finally {
    // Revoke on the next tick so the click has started the download.
    if (typeof data !== "string") window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function electronUpdater(): Updater | undefined {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (!api) return undefined;
  return {
    check: () => api.checkForUpdates(),
    install: () => api.quitAndInstallUpdate(),
    openReleasesPage: () => api.openReleasesPage(),
    onStatus: (cb) => api.onUpdaterStatus(cb)
  };
}

/**
 * The implementation for Electron and the dev-only browser build. Everything a web view can do
 * safely lives here; Electron-only extras (updater, taskbar attention) come from the preload API.
 * A mobile shell starts from this and overrides what its native plugins do better.
 */
export function browserPlatform(): Platform {
  const electron = typeof window !== "undefined" ? window.electronAPI : undefined;
  return {
    kind: electron ? "desktop" : "web",
    // The browser build is dev-only; it shares the desktop name so it doesn't add device rows.
    deviceName: "Orbit Desktop",
    // Desktop builds with the keychain-backed preload store move secrets there (B4); the dev
    // browser build and older preloads keep localStorage.
    secureStore: electron?.secureStore ? createDesktopSecureStore(electron.secureStore, localStorage) : localStorageStore,

    notifications: {
      supported: notificationsAvailable,
      permission: async () => (notificationsAvailable() ? (Notification.permission as NotificationPermissionState) : "denied"),
      requestPermission: async () =>
        notificationsAvailable() ? ((await Notification.requestPermission()) as NotificationPermissionState) : "denied",
      show: ({ title, body, tag, onClick }) => {
        if (!notificationsAvailable() || Notification.permission !== "granted") return;
        const notification = new Notification(title, { body, tag, silent: true, icon: "logo.png" });
        notification.onclick = () => {
          electron?.focusWindow?.();
          window.focus();
          onClick?.();
          notification.close();
        };
      }
    },
    requestAttention: () => electron?.requestAttention?.(),

    clipboard: {
      writeText: async (text) => {
        if (!navigator.clipboard) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(text);
      }
    },
    saveFile: downloadViaAnchor,
    // Electron's window-open handler sends allowed http(s) URLs to the system browser.
    openExternal: (url) => void window.open(url, "_blank", "noopener,noreferrer"),

    appInfo: async () => {
      if (!electron) return { version: "dev", os: null };
      const [version, os] = await Promise.all([
        electron.getVersion().catch(() => "unknown"),
        electron.getPlatform().catch(() => null)
      ]);
      return { version, os };
    },
    updater: electronUpdater()
  };
}
