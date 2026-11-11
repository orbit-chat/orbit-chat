// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, publicKeyFromPrivateKey } from "../../lib/crypto";
import { getInstallId, resetInstallIdCache, setPlatform, type SecureStore } from "../../platform";

const addMyPublicKey = vi.fn(async () => []);
const login = vi.fn();
const getMyIdentity = vi.fn(async (): Promise<null> => null);
const publishIdentity = vi.fn(async () => ({}));
vi.mock("../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api")>()),
  addMyPublicKey: (...args: unknown[]) => addMyPublicKey(...(args as [])),
  login: (...args: unknown[]) => login(...args),
  getMyIdentity: () => getMyIdentity(),
  publishIdentity: () => publishIdentity()
}));

/** An unsigned token whose payload carries a device ID, as the server's access tokens do. */
function tokenFor(deviceId: string) {
  const payload = btoa(JSON.stringify({ sub: "user-1", deviceId, exp: Math.floor(Date.now() / 1000) + 900 }));
  return `h.${payload.replace(/=+$/, "")}.s`;
}

const { useE2EEStore, devicePrivateKeyStorageKey } = await import("../e2eeStore");
const { useAuthStore } = await import("../authStore");

function memoryStore(): SecureStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key)
  };
}

const USER = "user-1";

beforeEach(() => {
  addMyPublicKey.mockClear();
  getMyIdentity.mockReset().mockResolvedValue(null);
  publishIdentity.mockClear();
  login.mockReset();
  localStorage.clear();
  setPlatform(null);
  resetInstallIdCache();
  useE2EEStore.setState({ publishedDeviceKeyByUserId: {}, deviceIdentityStatusByUserId: {} });
  useAuthStore.getState().clearSession();
});

describe("device keypair", () => {
  it("creates one keypair when several callers race on a fresh device", async () => {
    const store = memoryStore();
    setPlatform({ kind: "ios", deviceName: "Orbit iOS", secureStore: store });

    const results = await Promise.all([1, 2, 3].map(() => useE2EEStore.getState().ensureDeviceKeypair(USER, "t")));

    expect(new Set(results.map((r) => r.privateKey)).size).toBe(1);
    expect(addMyPublicKey).toHaveBeenCalledTimes(1);
    expect(addMyPublicKey).toHaveBeenCalledWith(results[0]!.publicKey, "t");
    expect(store.data.get(devicePrivateKeyStorageKey(USER))).toBe(results[0]!.privateKey);
  });

  it("keeps the key desktop installs already have in localStorage", async () => {
    const existing = await generateKeypair();
    localStorage.setItem(`orbit:privateKey:${USER}`, existing.privateKey);

    const result = await useE2EEStore.getState().ensureDeviceKeypair(USER, "t");

    expect(result.privateKey).toBe(existing.privateKey);
    expect(result.publicKey).toBe(await publicKeyFromPrivateKey(existing.privateKey));
  });

  it("doesn't store a private key whose public half the server never accepted", async () => {
    const store = memoryStore();
    setPlatform({ kind: "android", deviceName: "Orbit Android", secureStore: store });
    addMyPublicKey.mockRejectedValueOnce(new Error("offline"));

    await expect(useE2EEStore.getState().ensureDeviceKeypair(USER, "t")).rejects.toThrow("offline");
    expect(store.data.size).toBe(0);
  });

  it("signs in with the platform's device name and key store", async () => {
    const store = memoryStore();
    setPlatform({ kind: "android", deviceName: "Orbit Android", secureStore: store });
    login.mockResolvedValue({ user: { id: USER, username: "ada" }, accessToken: "a", refreshToken: "r" });

    await useAuthStore.getState().login("ada", "pw");

    expect(login).toHaveBeenCalledWith({
      username: "ada",
      password: "pw",
      deviceName: "Orbit Android",
      installId: store.data.get("orbit:installId"),
    });
    expect(store.data.has(devicePrivateKeyStorageKey(USER))).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(useAuthStore.getState().user?.id).toBe(USER);
  });
});

describe("device identity on sign-in", () => {
  it("publishes this device's identity in the background after sign-in", async () => {
    setPlatform({ kind: "desktop", deviceName: "Orbit Desktop", secureStore: memoryStore() });
    login.mockResolvedValue({ user: { id: USER, username: "ada" }, accessToken: tokenFor("device-1"), refreshToken: "r" });

    await useAuthStore.getState().login("ada", "pw");

    await vi.waitFor(() => expect(useE2EEStore.getState().deviceIdentityStatusByUserId[USER]).toBe("trusted"));
    expect(publishIdentity).toHaveBeenCalledTimes(1);
  });

  it("never fails sign-in when the identity sync fails", async () => {
    setPlatform({ kind: "desktop", deviceName: "Orbit Desktop", secureStore: memoryStore() });
    getMyIdentity.mockRejectedValue(new Error("Cannot GET /identity/me"));
    login.mockResolvedValue({ user: { id: USER, username: "ada" }, accessToken: tokenFor("device-1"), refreshToken: "r" });

    await useAuthStore.getState().login("ada", "pw");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAuthStore.getState().user?.id).toBe(USER);
    expect(useAuthStore.getState().error).toBeNull();
    expect(useE2EEStore.getState().deviceIdentityStatusByUserId[USER]).toBeUndefined();
  });
});

/** Mobile plan B2: the server tells devices apart by install ID, so it must be stable and unique. */
describe("install ID", () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("is created once, stored, and sent on every sign-in, including after a restart", async () => {
    const store = memoryStore();
    setPlatform({ kind: "ios", deviceName: "Orbit iOS", secureStore: store });
    login.mockResolvedValue({ user: { id: USER, username: "ada" }, accessToken: "a", refreshToken: "r" });

    await useAuthStore.getState().login("ada", "pw");
    resetInstallIdCache(); // simulate an app restart: only the secure store survives
    await useAuthStore.getState().login("ada", "pw");

    const sent = login.mock.calls.map((call) => (call[0] as { installId: string }).installId);
    expect(sent[0]).toMatch(UUID_V4);
    expect(sent[1]).toBe(sent[0]);
    expect(store.data.get("orbit:installId")).toBe(sent[0]);
  });

  it("gives concurrent callers on a fresh install the same ID", async () => {
    const store = memoryStore();
    setPlatform({ kind: "android", deviceName: "Orbit Android", secureStore: store });

    const ids = await Promise.all([1, 2, 3].map(() => getInstallId()));

    expect(new Set(ids).size).toBe(1);
  });

  it("differs between installs", async () => {
    setPlatform({ kind: "ios", deviceName: "Orbit iOS", secureStore: memoryStore() });
    const first = await getInstallId();
    resetInstallIdCache();
    setPlatform({ kind: "ios", deviceName: "Orbit iOS", secureStore: memoryStore() });

    expect(await getInstallId()).not.toBe(first);
  });

  it("replaces a malformed stored value the server would reject", async () => {
    const store = memoryStore();
    store.data.set("orbit:installId", "Orbit Desktop");
    setPlatform({ kind: "desktop", deviceName: "Orbit Desktop", secureStore: store });

    const id = await getInstallId();

    expect(id).toMatch(UUID_V4);
    expect(store.data.get("orbit:installId")).toBe(id);
  });
});
