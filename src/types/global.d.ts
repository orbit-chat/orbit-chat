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
    electronAPI: {
      getVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
      quitAndInstallUpdate: () => Promise<{ mode: "install" | "manual-download" }>;
      openReleasesPage: () => Promise<{ ok: boolean }>;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChanged: (cb: (maximized: boolean) => void) => () => void;
      onUpdaterStatus: (cb: (payload: UpdaterStatusPayload) => void) => () => void;
    };
  }
}
