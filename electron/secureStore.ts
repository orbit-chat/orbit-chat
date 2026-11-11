import { app, ipcMain, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { SecureStoreFile } from "./secureStoreFile";

export type SecureStoreStatus = "ok" | "unavailable" | "locked";

/**
 * Whether secrets can be stored, given what Electron reports and whether a store file exists.
 *
 * - "ok": safeStorage works.
 * - "locked": it doesn't, but a store file exists (or can't be checked). The renderer must stop
 *   rather than treat its keys as missing and generate new ones, which would lose history.
 * - "unavailable": no usable keychain and nothing stored yet (Linux without a keyring, where
 *   safeStorage would only use a hard-coded key). The renderer keeps using localStorage, as before.
 */
export function secureStoreStatus(params: {
  encryptionAvailable: boolean;
  platform: NodeJS.Platform;
  linuxBackend: string | null;
  fileState: "present" | "absent" | "unknown";
}): SecureStoreStatus {
  const plaintextBackend = params.platform === "linux" && (params.linuxBackend === "basic_text" || params.linuxBackend === "unknown");
  if (params.encryptionAvailable && !plaintextBackend) return "ok";
  return params.fileState === "absent" ? "unavailable" : "locked";
}

function fileState(filePath: string): "present" | "absent" | "unknown" {
  try {
    fs.statSync(filePath);
    return "present";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unknown";
  }
}

/**
 * IPC for the renderer's secure store (mobile plan B4). The renderer migrates its secrets out of
 * localStorage into this store (src/platform/desktopSecureStore.ts) once its status is "ok".
 */
export function registerSecureStore() {
  const filePath = path.join(app.getPath("userData"), "secure-store.json");
  const status = () =>
    secureStoreStatus({
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      platform: process.platform,
      linuxBackend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null,
      fileState: fileState(filePath)
    });

  const file = new SecureStoreFile(filePath, {
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (encrypted) => safeStorage.decryptString(encrypted)
  });
  const store = () => {
    if (status() !== "ok") throw new Error("Secure storage is unavailable");
    return file;
  };

  ipcMain.handle("secureStore:status", () => status());
  ipcMain.handle("secureStore:get", (_event, key: unknown) => {
    if (!SecureStoreFile.validKey(key)) throw new Error("Invalid secure store key");
    return store().get(key);
  });
  ipcMain.handle("secureStore:set", (_event, key: unknown, value: unknown) => {
    if (!SecureStoreFile.validKey(key) || typeof value !== "string") throw new Error("Invalid secure store entry");
    store().set(key, value);
  });
  ipcMain.handle("secureStore:remove", (_event, key: unknown) => {
    if (!SecureStoreFile.validKey(key)) throw new Error("Invalid secure store key");
    store().remove(key);
  });
}
