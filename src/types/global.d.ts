export {};

declare global {
  type UpdaterStatus = "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";

  type UpdaterStatusPayload = {
    status: UpdaterStatus;
    version?: string;
    progress?: number;
    message?: string;
  };

  interface Window {
    /** Exposed by electron/preload.ts. Undefined when the renderer runs in a plain browser (dev:new:web). */
    electronAPI?: {
      getVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
      quitAndInstallUpdate: () => Promise<{ mode: "install" | "manual-download" }>;
      openReleasesPage: () => Promise<{ ok: boolean }>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      /** Restore and focus the window (added with the new UI; optional for older preload builds). */
      focusWindow?: () => void;
      /** Flash the taskbar entry if the window isn't focused. */
      requestAttention?: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChanged: (cb: (maximized: boolean) => void) => () => void;
      onUpdaterStatus: (cb: (payload: UpdaterStatusPayload) => void) => () => void;
    };
  }
}
