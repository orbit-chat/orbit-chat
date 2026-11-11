// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair } from "../../../lib/crypto";
import { generateSigningKeypair, signDeviceList, verifyDeviceList, type DeviceListEntry } from "../../../lib/deviceTrust";
import { setPlatform, type SecureStore } from "../../../platform";
import { conversation, group, member } from "../../conversations/__tests__/fixtures";

/**
 * Revoking devices (mobile plan B8): the revoke is a new signed list without the device; this
 * device then rotates its chats, and wipes itself if it was the one removed. A contact whose list
 * shrinks makes this device rotate shared chats before its next send, whatever the server says.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ME = "44444444-4444-4444-8444-444444444444";
const PHONE = "55555555-5555-4555-8555-555555555555";
const token = `h.${btoa(JSON.stringify({ deviceId: ME }))}.s`;

const server = { identityKey: "", lists: [] as Array<{ version: number; body: string; signature: string }>, contact: null as null | { identityKey: string; deviceList: { version: number; body: string; signature: string } } };
const rotateConversationKey = vi.fn(async () => ({ conversationId: "g", keyVersion: 2 }));
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  getMyIdentity: async () => ({ identityKey: server.identityKey, deviceList: server.lists.at(-1)! }),
  getUserIdentity: async () => server.contact,
  publishDeviceList: async (list: { body: string; signature: string }) => {
    const parsed = await verifyDeviceList(list, server.identityKey, { expectedUserId: USER });
    server.lists.push({ version: parsed.version, ...list });
    return { identityKey: server.identityKey, deviceList: server.lists.at(-1)! };
  },
  rotateConversationKey: (...args: unknown[]) => (rotateConversationKey as (...a: unknown[]) => unknown)(...args),
  getMyConversationKeys: async () => [],
  addMyPublicKey: async () => [],
}));

const { removeLinkedDevice } = await import("../revokeDevice");
const { getContactDevices, identityKeyStorageKey, deviceSigningKeyStorageKey } = await import("../../../lib/deviceIdentity");
const { useE2EEStore, devicePrivateKeyStorageKey } = await import("../../../stores/e2eeStore");
const { useConversationsStore } = await import("../../conversations/conversationsStore");

function memoryStore(): SecureStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}

async function entry(deviceId: string): Promise<{ entry: DeviceListEntry; enc: { publicKey: string; privateKey: string }; sign: { publicKey: string; privateKey: string } }> {
  const enc = await generateKeypair();
  const sign = await generateSigningKeypair();
  return { entry: { deviceId, encryptionPublicKey: enc.publicKey, signingPublicKey: sign.publicKey, name: deviceId, addedAt: 1 }, enc, sign };
}

let store: ReturnType<typeof memoryStore>;
let identity: { publicKey: string; privateKey: string };

beforeEach(async () => {
  await sodium.ready;
  rotateConversationKey.mockClear();
  identity = await generateSigningKeypair();
  const me = await entry(ME);
  const phone = await entry(PHONE);
  server.identityKey = identity.publicKey;
  server.lists = [{ version: 1, ...(await signDeviceList({ userId: USER, version: 1, devices: [me.entry, phone.entry] }, identity.privateKey)) }];
  store = memoryStore();
  setPlatform({ kind: "desktop", deviceName: "Orbit Desktop", secureStore: store });
  await store.set(identityKeyStorageKey(USER), identity.privateKey);
  await store.set(devicePrivateKeyStorageKey(USER), me.enc.privateKey);
  await store.set(deviceSigningKeyStorageKey(USER), me.sign.privateKey);
  useE2EEStore.getState().reset();
  useE2EEStore.setState({ perDeviceKeysByUserId: { [USER]: true }, thisDevice: vi.fn(async () => ({ userId: USER, deviceId: ME, encryption: me.enc, signingPrivateKey: me.sign.privateKey })) });
  useConversationsStore.setState({ conversations: [group("g", ["ada"])] });
});

describe("removing a linked device", () => {
  it("publishes a list without it and rotates this device's chats", async () => {
    // A chat whose only other device is this user's own (contacts' lists aren't needed to seal).
    useConversationsStore.setState({ conversations: [conversation({ id: "g", type: "group", members: [member(USER, "me")] })] });
    expect(await removeLinkedDevice({ userId: USER, token, deviceId: PHONE })).toEqual({ forgotThisDevice: false });
    const latest = await verifyDeviceList(server.lists.at(-1)!, identity.publicKey, { expectedUserId: USER });
    expect(latest.version).toBe(2);
    expect(latest.devices.map((d) => d.deviceId)).toEqual([ME]);
    await vi.waitFor(() => expect(rotateConversationKey).toHaveBeenCalled());
    // Sealed only to the devices still listed: the removed phone gets nothing.
    const write = (rotateConversationKey.mock.calls[0] as unknown as [string, { deviceKeys: Array<{ deviceId: string }> }])[1];
    expect(write.deviceKeys.map((k) => k.deviceId)).toEqual([ME]);
  });

  it("won't remove the only linked device, or one that isn't linked", async () => {
    await removeLinkedDevice({ userId: USER, token, deviceId: PHONE });
    await expect(removeLinkedDevice({ userId: USER, token, deviceId: ME })).rejects.toThrow(/only linked device/);
    await expect(removeLinkedDevice({ userId: USER, token, deviceId: "66666666-6666-4666-8666-666666666666" })).rejects.toThrow(/isn't linked/);
    expect(server.lists).toHaveLength(2);
  });

  it("forgets this device when it removes itself", async () => {
    expect(await removeLinkedDevice({ userId: USER, token, deviceId: ME })).toEqual({ forgotThisDevice: true });
    expect(store.data.has(identityKeyStorageKey(USER))).toBe(false);
    expect(store.data.has(devicePrivateKeyStorageKey(USER))).toBe(false);
    expect(store.data.has(deviceSigningKeyStorageKey(USER))).toBe(false);
    const latest = await verifyDeviceList(server.lists.at(-1)!, identity.publicKey, { expectedUserId: USER });
    expect(latest.devices.map((d) => d.deviceId)).toEqual([PHONE]);
  });
});

describe("a contact revoking a device", () => {
  it("flags every chat shared with them for a new key before this device sends", async () => {
    const ada = await generateSigningKeypair();
    const adaPhone = await entry("77777777-7777-4777-8777-777777777777");
    const adaDesktop = await entry("88888888-8888-4888-8888-888888888888");
    const publishAda = async (version: number, devices: DeviceListEntry[]) => {
      server.contact = { identityKey: ada.publicKey, deviceList: { version, ...(await signDeviceList({ userId: "ada", version, devices }, ada.privateKey)) } };
    };
    useConversationsStore.setState({ conversations: [group("g", ["ada"]), group("other", ["bob"])] });

    await publishAda(1, [adaPhone.entry, adaDesktop.entry]);
    await getContactDevices(USER, "ada", token);
    expect(useConversationsStore.getState().conversations.every((c) => !c.rotationRequired)).toBe(true);

    await publishAda(2, [adaDesktop.entry]);
    const seen = await getContactDevices(USER, "ada", token);
    expect(seen.status === "verified" && seen.removedDeviceIds).toEqual([adaPhone.entry.deviceId]);
    const flags = Object.fromEntries(useConversationsStore.getState().conversations.map((c) => [c.id, Boolean(c.rotationRequired)]));
    expect(flags).toEqual({ g: true, other: false });
  });
});
