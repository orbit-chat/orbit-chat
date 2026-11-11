// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair, generateSecretKey, sealToPublicKey } from "../../lib/crypto";
import { generateSigningKeypair, type DeviceListEntry } from "../../lib/deviceTrust";
import { setPlatform, type SecureStore } from "../../platform";
import { group } from "../../features/conversations/__tests__/fixtures";

/**
 * The key store's per-device behaviour (mobile plan M1b): the protocol choice can't be
 * downgraded once seen, an unlinked device never fetches or opens keys, and the one-time legacy
 * move re-seals what this device can open and then stops trusting unsigned rows.
 */

const api = {
  getE2eeConfig: vi.fn(),
  getMyConversationKeys: vi.fn(),
  getConversations: vi.fn(),
  storeDeviceKeyBatch: vi.fn(),
  addMyPublicKey: vi.fn(),
};
vi.mock("../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)])),
}));

let ownList: DeviceListEntry[] = [];
const identityStatus = vi.fn();
vi.mock("../../lib/deviceIdentity", async (importActual) => ({
  ...(await importActual<typeof import("../../lib/deviceIdentity")>()),
  bootstrapDeviceIdentity: () => identityStatus(),
  getOwnDevices: async () => ({ userId: "me", version: 1, devices: ownList }),
  getContactDevices: async () => ({ status: "no-identity" }),
}));

const { ApiError } = await import("../../lib/api");
const { useE2EEStore, perDeviceKeysStorageKey, legacyKeysMovedStorageKey, devicePrivateKeyStorageKey } = await import("../e2eeStore");
const { PER_DEVICE_SEEN_HINT, chosenInterface, UI_PREFERENCE_KEY } = await import("../../lib/uiPreference");
const { deviceSigningKeyStorageKey } = await import("../../lib/deviceIdentity");

function memoryStore(): SecureStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  };
}

/** An access token whose payload names this device (the client never verifies it). */
const token = `h.${btoa(JSON.stringify({ deviceId: "dev-me" }))}.s`;
let store: ReturnType<typeof memoryStore>;
let enc: { publicKey: string; privateKey: string };
let sign: { publicKey: string; privateKey: string };
let phone: DeviceListEntry;
const CONVERSATION = "11111111-1111-4111-8111-111111111111";

beforeEach(async () => {
  await sodium.ready;
  for (const fn of Object.values(api)) fn.mockReset();
  api.addMyPublicKey.mockResolvedValue([]);
  api.storeDeviceKeyBatch.mockResolvedValue({ stored: 0, skipped: 0 });
  identityStatus.mockReset().mockResolvedValue("trusted");
  store = memoryStore();
  setPlatform({ kind: "desktop", deviceName: "Orbit Desktop", secureStore: store });
  enc = await generateKeypair();
  sign = await generateSigningKeypair();
  await store.set(devicePrivateKeyStorageKey("me"), enc.privateKey);
  await store.set(deviceSigningKeyStorageKey("me"), sign.privateKey);
  phone = { deviceId: "dev-phone", encryptionPublicKey: (await generateKeypair()).publicKey, signingPublicKey: (await generateSigningKeypair()).publicKey, name: "Orbit iOS", addedAt: 1 };
  ownList = [{ deviceId: "dev-me", encryptionPublicKey: enc.publicKey, signingPublicKey: sign.publicKey, name: "Orbit Desktop", addedAt: 1 }, phone];
  localStorage.clear();
  useE2EEStore.getState().reset();
});

describe("which key protocol", () => {
  it("stays on per-device keys once seen, whatever the server says later", async () => {
    api.getE2eeConfig.mockResolvedValueOnce({ perDeviceKeys: true });
    expect(await useE2EEStore.getState().ensureKeyMode("me")).toBe(true);
    expect(store.data.get(perDeviceKeysStorageKey("me"))).toBe("1");

    useE2EEStore.getState().reset();
    api.getE2eeConfig.mockResolvedValueOnce({ perDeviceKeys: false });
    expect(await useE2EEStore.getState().ensureKeyMode("me")).toBe(true);
    useE2EEStore.getState().reset();
    api.getE2eeConfig.mockRejectedValueOnce(new Error("offline"));
    expect(await useE2EEStore.getState().ensureKeyMode("me")).toBe(true);
  });

  it("uses legacy keys on a server without the switch, and asks again after a failed check", async () => {
    api.getE2eeConfig.mockRejectedValueOnce(new ApiError("Not Found", 404));
    expect(await useE2EEStore.getState().ensureKeyMode("me")).toBe(false);
    expect(await useE2EEStore.getState().ensureKeyMode("me")).toBe(false);
    expect(api.getE2eeConfig).toHaveBeenCalledTimes(1);

    useE2EEStore.getState().reset();
    api.getE2eeConfig.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ perDeviceKeys: true });
    expect(await useE2EEStore.getState().ensureKeyMode("me")).toBe(false);
    expect(await useE2EEStore.getState().ensureKeyMode("me")).toBe(true);
  });

  it("stops offering the classic interface, which only speaks legacy keys", async () => {
    localStorage.setItem(UI_PREFERENCE_KEY, "classic");
    expect(chosenInterface()).toBe("classic");
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });
    api.getE2eeConfig.mockResolvedValueOnce({ perDeviceKeys: true });
    await useE2EEStore.getState().ensureKeyMode("me");
    expect(localStorage.getItem(PER_DEVICE_SEEN_HINT)).toBe("1");
    expect(chosenInterface()).toBe("new");
    expect(reload).toHaveBeenCalled();
  });
});

describe("an unlinked device", () => {
  it("never fetches or opens keys, and says how to fix it", async () => {
    useE2EEStore.setState({ perDeviceKeysByUserId: { me: true } });
    identityStatus.mockResolvedValue("pending");
    const key = await useE2EEStore.getState().ensureConversationSecretKey({ conversation: group(CONVERSATION, ["ada"]), token, myUserId: "me" });
    expect(key).toBeNull();
    expect(api.getMyConversationKeys).not.toHaveBeenCalled();
    expect(useE2EEStore.getState().errorByConversationId[CONVERSATION]).toMatch(/Link this device/);
  });
});

describe("the one-time legacy move", () => {
  async function legacyRow(secretKey: string, keyVersion: number) {
    return { id: `l${keyVersion}`, conversationId: CONVERSATION, userId: "me", encryptedGroupKey: await sealToPublicKey(secretKey, enc.publicKey), keyVersion, createdAt: "", updatedAt: "", deviceId: null, legacy: true };
  }

  it("re-seals legacy keys for every own device, then stops trusting unsigned rows", async () => {
    useE2EEStore.setState({ perDeviceKeysByUserId: { me: true } });
    const legacyKey = await generateSecretKey();
    api.getConversations.mockResolvedValue([group(CONVERSATION, ["ada"])]);
    api.getMyConversationKeys.mockResolvedValue([await legacyRow(legacyKey, 1)]);

    // Before the move, the legacy key reads history (but isn't sendable).
    await useE2EEStore.getState().ensureConversationSecretKey({ conversation: group(CONVERSATION, ["ada"]), token, myUserId: "me" });
    expect(useE2EEStore.getState().getConversationSecretKeyForVersion(CONVERSATION, 1)).toBe(legacyKey);
    expect(useE2EEStore.getState().sendableByConversationId[CONVERSATION]).toBe(false);

    expect(await useE2EEStore.getState().migrateLegacyKeys("me", token)).toBe(true);
    const batch = api.storeDeviceKeyBatch.mock.calls[0]![0] as Array<{ deviceId: string; keyVersion: number; conversationId: string }>;
    expect(batch.map((k) => [k.conversationId, k.keyVersion, k.deviceId])).toEqual([
      [CONVERSATION, 1, "dev-me"],
      [CONVERSATION, 1, "dev-phone"],
    ]);
    expect(store.data.get(legacyKeysMovedStorageKey("me"))).toBe("dev-me");

    // After the move, unsigned rows are ignored; this device's signed copy is what it reads.
    useE2EEStore.getState().reset();
    useE2EEStore.setState({ perDeviceKeysByUserId: { me: true } });
    const mine = batch[0]! as unknown as { sealedKey: string; signature: string };
    api.getMyConversationKeys.mockResolvedValue([
      await legacyRow(await generateSecretKey(), 2),
      { id: "s1", conversationId: CONVERSATION, userId: "me", encryptedGroupKey: mine.sealedKey, keyVersion: 1, createdAt: "", updatedAt: "", deviceId: "dev-me", issuerDeviceId: "dev-me", signature: mine.signature, issuerUserId: "me", legacy: false },
    ]);
    await useE2EEStore.getState().ensureConversationSecretKey({ conversation: group(CONVERSATION, ["ada"]), token, myUserId: "me" });
    expect(useE2EEStore.getState().secretKeyByConversationIdAndVersion[CONVERSATION]).toEqual({ 1: legacyKey });
    expect(useE2EEStore.getState().keyVersionByConversationId[CONVERSATION]).toBe(2);
    expect(useE2EEStore.getState().sendableByConversationId[CONVERSATION]).toBe(false);

    // Done is done: no second move.
    api.storeDeviceKeyBatch.mockClear();
    expect(await useE2EEStore.getState().migrateLegacyKeys("me", token)).toBe(true);
    expect(api.storeDeviceKeyBatch).not.toHaveBeenCalled();
  });

  it("keeps trusting legacy rows and tries again next time if any conversation failed to move", async () => {
    useE2EEStore.setState({ perDeviceKeysByUserId: { me: true } });
    api.getConversations.mockResolvedValue([group(CONVERSATION, ["ada"])]);
    api.getMyConversationKeys.mockResolvedValue([await legacyRow(await generateSecretKey(), 1)]);
    api.storeDeviceKeyBatch.mockRejectedValueOnce(new Error("offline"));
    expect(await useE2EEStore.getState().migrateLegacyKeys("me", token)).toBe(false);
    expect(store.data.has(legacyKeysMovedStorageKey("me"))).toBe(false);
  });

  it("does nothing on a legacy server or an unlinked device", async () => {
    api.getE2eeConfig.mockResolvedValue({ perDeviceKeys: false });
    expect(await useE2EEStore.getState().migrateLegacyKeys("me", token)).toBe(false);
    useE2EEStore.getState().reset();
    useE2EEStore.setState({ perDeviceKeysByUserId: { me: true } });
    identityStatus.mockResolvedValue("pending");
    await expect(useE2EEStore.getState().migrateLegacyKeys("me", token)).rejects.toThrow(/Link this device/);
    expect(api.getConversations).not.toHaveBeenCalled();
  });
});

describe("signing out", () => {
  it("forgets every conversation key", async () => {
    useE2EEStore.getState().setConversationSecretKeyVersion({ conversationId: CONVERSATION, keyVersion: 1, secretKey: await generateSecretKey() });
    useE2EEStore.getState().reset();
    expect(useE2EEStore.getState().secretKeyByConversationIdAndVersion).toEqual({});
    expect(useE2EEStore.getState().secretKeyByConversationId).toEqual({});
  });
});
