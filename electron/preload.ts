import { contextBridge, ipcRenderer } from "electron";

const electronAPI = {
  getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
