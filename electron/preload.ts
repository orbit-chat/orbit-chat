import { contextBridge, ipcRenderer } from "electron";

type UpdaterStatus = "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";

type UpdaterStatusPayload = {
  status: UpdaterStatus;
  version?: string;
  progress?: number;
  message?: string;
};

const electronAPI = {
  getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,
  getPlatform: () => ipcRenderer.invoke("app:getPlatform") as Promise<string>,
  checkForUpdates: () => ipcRenderer.invoke("updater:checkForUpdates") as Promise<{ ok: boolean; reason?: string }>,
  quitAndInstallUpdate: () => ipcRenderer.invoke("updater:quitAndInstall") as Promise<{ mode: "install" | "manual-download" }>,
  openReleasesPage: () => ipcRenderer.invoke("updater:openReleases") as Promise<{ ok: boolean }>,
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
  onMaximizedChanged: (cb: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized);
    ipcRenderer.on("window:maximized-changed", handler);
    return () => { ipcRenderer.removeListener("window:maximized-changed", handler); };
  },
  onUpdaterStatus: (cb: (payload: UpdaterStatusPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: UpdaterStatusPayload) => cb(payload);
    ipcRenderer.on("updater:status", handler);
    return () => {
      ipcRenderer.removeListener("updater:status", handler);
    };
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
