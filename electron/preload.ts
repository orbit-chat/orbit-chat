import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized") as Promise<boolean>,
  onMaximizedChanged: (cb: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized);
    ipcRenderer.on("window:maximized-changed", handler);
    return () => { ipcRenderer.removeListener("window:maximized-changed", handler); };
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
