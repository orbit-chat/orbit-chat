// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type SecureStore } from "../../platform";

/**
 * Phones stay signed in (mobile plan M3): the rotating refresh token lives in the secure store,
 * is rewritten on every refresh, and is forgotten on sign-out or when the server refuses it.
 * Desktop keeps nothing.
 */

const api = { login: vi.fn(), refreshToken: vi.fn(), addMyPublicKey: vi.fn(async () => []), getE2eeConfig: vi.fn(async () => ({ perDeviceKeys: false })), getMyIdentity: vi.fn(async () => null) };
vi.mock("../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args)])),
}));

const { ApiError } = await import("../../lib/api");
const { useAuthStore } = await import("../authStore");
const { useE2EEStore } = await import("../e2eeStore");

function memoryStore(): SecureStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}

const jwt = (deviceId: string) => `h.${btoa(JSON.stringify({ deviceId, exp: Math.floor(Date.now() / 1000) + 900 }))}.s`;
let store: ReturnType<typeof memoryStore>;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
  store = memoryStore();
  setPlatform({ kind: "ios", deviceName: "Orbit iOS", secureStore: store });
  useAuthStore.setState({ token: null, refreshToken: null, user: null, loading: false, error: null });
  useE2EEStore.getState().reset();
  useE2EEStore.setState({ ensureDeviceKeypair: vi.fn(async () => ({ publicKey: "pk", privateKey: "sk" })) });
  api.login.mockResolvedValue({ user: { id: "u1", username: "ada" }, accessToken: jwt("d1"), refreshToken: "rt-1" });
});

describe("staying signed in on phones", () => {
  it("keeps the refresh token in the secure store and restores the session from it", async () => {
    await useAuthStore.getState().login("ada", "pw");
    expect(JSON.parse(store.data.get("orbit:session")!)).toEqual({ refreshToken: "rt-1", user: { id: "u1", username: "ada" } });

    // Next launch: nothing in memory, the stored token is exchanged (and rotated).
    useAuthStore.setState({ token: null, refreshToken: null, user: null });
    api.refreshToken.mockResolvedValueOnce({ accessToken: jwt("d1"), refreshToken: "rt-2" });
    expect(await useAuthStore.getState().restoreSession()).toBe(true);
    expect(api.refreshToken).toHaveBeenCalledWith("rt-1");
    expect(useAuthStore.getState().user).toEqual({ id: "u1", username: "ada" });
    expect(JSON.parse(store.data.get("orbit:session")!).refreshToken).toBe("rt-2");
  });

  it("forgets the stored session on sign-out and when the server refuses it, but not on a network error", async () => {
    await useAuthStore.getState().login("ada", "pw");
    useAuthStore.getState().clearSession();
    await vi.waitFor(() => expect(store.data.has("orbit:session")).toBe(false));

    store.data.set("orbit:session", JSON.stringify({ refreshToken: "rt-old", user: { id: "u1", username: "ada" } }));
    api.refreshToken.mockRejectedValueOnce(new Error("Unable to reach Orbit server"));
    expect(await useAuthStore.getState().restoreSession()).toBe(false);
    expect(store.data.has("orbit:session")).toBe(true);

    api.refreshToken.mockRejectedValueOnce(new ApiError("Invalid refresh token", 401));
    expect(await useAuthStore.getState().restoreSession()).toBe(false);
    expect(store.data.has("orbit:session")).toBe(false);
  });

  it("keeps nothing on desktop", async () => {
    setPlatform({ kind: "desktop", deviceName: "Orbit Desktop", secureStore: store });
    await useAuthStore.getState().login("ada", "pw");
    expect(store.data.has("orbit:session")).toBe(false);
    expect(await useAuthStore.getState().restoreSession()).toBe(false);
  });
});
