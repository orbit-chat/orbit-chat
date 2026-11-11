/**
 * What the shared renderer needs from the shell it runs in (Electron, a browser, or the
 * iOS/Android shells planned in docs/mobile-plan.md). Code outside src/platform asks for
 * these instead of reaching for window.electronAPI, Notification, navigator.clipboard or
 * localStorage directly, so a mobile shell only has to supply its own implementation.
 */
import { browserPlatform } from "./browser";

export { localStorageStore } from "./browser";

export type PlatformKind = "desktop" | "web" | "ios" | "android";

/** Storage for secrets such as the device private key. Async so native keychains fit behind it. */
export type SecureStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export type NotificationPermissionState = "granted" | "denied" | "default";

export type LocalNotifications = {
  supported: () => boolean;
  permission: () => Promise<NotificationPermissionState>;
  requestPermission: () => Promise<NotificationPermissionState>;
  /** `tag` groups notifications (one per conversation); `onClick` runs after the app is focused. */
  show: (params: { title: string; body: string; tag: string; onClick?: () => void }) => void;
};

/** Desktop auto-updater. Mobile apps update through their store, so they have none. */
export type Updater = {
  check: () => Promise<{ ok: boolean; reason?: string }>;
  install: () => Promise<{ mode: "install" | "manual-download" }>;
  openReleasesPage: () => Promise<{ ok: boolean }>;
  onStatus: (cb: (payload: UpdaterStatusPayload) => void) => () => void;
};

export type Platform = {
  kind: PlatformKind;
  /** Display label sent on sign-in. Devices are told apart by their install ID, not this name. */
  deviceName: string;
  secureStore: SecureStore;
  notifications: LocalNotifications;
  /** Draw the user's eye to the app (taskbar flash). No-op where the OS has no such thing. */
  requestAttention: () => void;
  clipboard: { writeText: (text: string) => Promise<void> };
  /** Save or share a file. `data` is a Blob, or an object/data URL that already holds one. */
  saveFile: (name: string, data: Blob | string) => Promise<void>;
  /** Open an http(s) URL outside the app, in the system browser. */
  openExternal: (url: string) => void;
  /** App version and OS (Electron's `process.platform` on desktop, e.g. "darwin"). */
  appInfo: () => Promise<{ version: string; os: string | null }>;
  updater?: Updater;
  /** Scan a QR code with the camera (device linking, B7). Absent where there is no camera flow. */
  scanQrCode?: () => Promise<string | null>;
  /**
   * This device's push token (APNs on iOS, FCM on Android), asking for permission first.
   * Null if refused or unavailable. Absent where there is no push (desktop uses the socket).
   */
  pushToken?: () => Promise<{ platform: "apns" | "fcm"; token: string } | null>;
  /** Foreground/background changes (mobile plan M5: app lock, chat locks). Returns an unsubscribe. */
  onAppStateChange?: (listener: (active: boolean) => void) => () => void;
  /** Face ID / Touch ID / fingerprint, falling back to the device passcode (M5 app lock). */
  biometric?: {
    available: () => Promise<boolean>;
    /** True only if the user authenticated. */
    verify: (reason: string) => Promise<boolean>;
  };
  /** Advisory root/jailbreak signs (M5). Never used to block anything. */
  deviceIntegrity?: () => Promise<{ compromised: boolean; reasons: string[] }>;
};

/** A shell or test supplies only what differs from the browser implementation. */
export type PlatformOverrides = Partial<Platform>;

let current: Platform | null = null;

export function getPlatform(): Platform {
  current ??= browserPlatform();
  return current;
}

/** Install a shell's implementation before the app mounts (mobile shells, tests); null resets. */
export function setPlatform(overrides: PlatformOverrides | null) {
  current = overrides ? { ...browserPlatform(), ...overrides } : null;
  // The install ID lives in the platform's secure store; don't keep one read from another store.
  installIdInFlight = null;
}

type Clickable = { preventDefault: () => void; button?: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
const isPlainClick = (event: Clickable) => !event.button && !event.ctrlKey && !event.metaKey && !event.shiftKey;

/** Props for an `<a>` that opens an http(s) URL outside the app, on every shell. */
export function externalLinkProps(href: string) {
  return {
    href,
    target: "_blank",
    rel: "noreferrer noopener",
    onClick: (event: Clickable) => {
      event.preventDefault();
      getPlatform().openExternal(href);
    }
  };
}

/** Props for an `<a>` that saves `url` (an object URL) as `name`, through the shell's file saver. */
export function downloadLinkProps(name: string, url: string | null | undefined) {
  return {
    href: url ?? undefined,
    download: name,
    onClick: (event: Clickable) => {
      if (!url || !isPlainClick(event)) return;
      event.preventDefault();
      void getPlatform().saveFile(name, url).catch(() => {});
    }
  };
}

/** True for the iOS and Android shells. */
export const isMobile = (kind: PlatformKind = getPlatform().kind) => kind === "ios" || kind === "android";

const INSTALL_ID_KEY = "orbit:installId";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let installIdInFlight: Promise<string> | null = null;

/**
 * Random ID for this install, created on first use and kept in the secure store. The server
 * identifies the device by it (mobile plan B2), so it is per install rather than per user and
 * survives signing out.
 */
export function getInstallId(): Promise<string> {
  installIdInFlight ??= (async () => {
    const store = getPlatform().secureStore;
    const existing = await store.get(INSTALL_ID_KEY);
    if (existing && UUID_V4.test(existing)) return existing;
    // A missing or malformed value gets replaced; the server only accepts v4 UUIDs.
    const created = crypto.randomUUID();
    await store.set(INSTALL_ID_KEY, created);
    return created;
  })().catch((error) => {
    installIdInFlight = null;
    throw error;
  });
  return installIdInFlight;
}

/** Tests only: forget the cached install ID so the next call reads the store again. */
export function resetInstallIdCache() {
  installIdInFlight = null;
}
