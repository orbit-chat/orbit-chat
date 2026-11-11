import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, ipcMain: {}, safeStorage: {} }));
const { secureStoreStatus } = await import("../secureStore");

describe("secureStoreStatus", () => {
  const base = { encryptionAvailable: true, platform: "win32" as NodeJS.Platform, linuxBackend: null, fileState: "absent" as const };

  it("is ok when the keychain works", () => {
    expect(secureStoreStatus(base)).toBe("ok");
    expect(secureStoreStatus({ ...base, platform: "linux", linuxBackend: "gnome_libsecret" })).toBe("ok");
  });

  it("is locked whenever secrets were stored but can't be opened now", () => {
    expect(secureStoreStatus({ ...base, encryptionAvailable: false, fileState: "present" })).toBe("locked");
    expect(secureStoreStatus({ ...base, platform: "linux", linuxBackend: "basic_text", fileState: "present" })).toBe("locked");
  });

  it("treats a file it can't check as locked, never as absent", () => {
    expect(secureStoreStatus({ ...base, encryptionAvailable: false, fileState: "unknown" })).toBe("locked");
  });

  it("is unavailable only when there's no usable keychain and nothing stored", () => {
    expect(secureStoreStatus({ ...base, encryptionAvailable: false })).toBe("unavailable");
    expect(secureStoreStatus({ ...base, platform: "linux", linuxBackend: "basic_text" })).toBe("unavailable");
    expect(secureStoreStatus({ ...base, platform: "linux", linuxBackend: "unknown" })).toBe("unavailable");
  });
});
