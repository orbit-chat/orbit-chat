import { beforeEach, describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair } from "../crypto";
import { generateSigningKeypair, signDeviceList, signingPublicKeyFromPrivateKey as signingPublicKeyOf, verifyDeviceList, type DeviceListEntry } from "../deviceTrust";
import { setPlatform, type SecureStore } from "../../platform";
import type { IdentityResponse } from "../api";

/**
 * The server here is a fake that may misbehave on purpose: serve an old list, swap a contact's
 * identity, or sign different lists under one version. Every case must end in this device
 * refusing, never in it quietly trusting what the server said.
 */

const server = new Map<string, IdentityResponse>();
const publishIdentity = vi.fn();
const publishDeviceList = vi.fn();
const resetIdentity = vi.fn();
const ME = "user-me";
const CONTACT = "user-contact";

vi.mock("../api", async (importActual) => {
  const actual = await importActual<typeof import("../api")>();
  return {
    ...actual,
    getMyIdentity: async () => server.get(ME) ?? null,
    getUserIdentity: async (userId: string) => server.get(userId) ?? null,
    publishIdentity: (...args: unknown[]) => publishIdentity(...args),
    publishDeviceList: (...args: unknown[]) => publishDeviceList(...args),
    resetIdentity: (...args: unknown[]) => resetIdentity(...args),
  };
});

const { ApiError } = await import("../api");
const {
  acceptContactIdentity,
  bootstrapDeviceIdentity,
  deviceSigningKeyStorageKey,
  ensureDeviceSigningKey,
  getContactDevices,
  identityKeyStorageKey,
  isContactVerified,
  markContactVerified,
  resetOwnIdentity,
} = await import("../deviceIdentity");

function memoryStore(): SecureStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
  };
}

let store: ReturnType<typeof memoryStore>;
let encryptionPublicKey: string;

function thisDevice(deviceId = "device-a") {
  return { userId: ME, deviceId, deviceName: "Orbit Desktop", encryptionPublicKey, token: "t" };
}

async function deviceEntry(deviceId: string): Promise<DeviceListEntry> {
  return {
    deviceId,
    encryptionPublicKey: (await generateKeypair()).publicKey,
    signingPublicKey: (await generateSigningKeypair()).publicKey,
    name: "Orbit iOS",
    addedAt: 1,
  };
}

async function publishFor(userId: string, identity: { privateKey: string; publicKey: string }, version: number, devices: DeviceListEntry[]) {
  const signed = await signDeviceList({ userId, version, devices }, identity.privateKey);
  server.set(userId, { identityKey: identity.publicKey, deviceList: { version, ...signed } });
}

beforeEach(async () => {
  await sodium.ready;
  server.clear();
  store = memoryStore();
  setPlatform({ kind: "desktop", deviceName: "Orbit Desktop", secureStore: store });
  encryptionPublicKey = (await generateKeypair()).publicKey;

  // Default fake behaviour: accept well-formed publications like the real server.
  publishIdentity.mockReset().mockImplementation(async (data: { identityKey: string; deviceList: { body: string; signature: string } }) => {
    if (server.has(ME)) throw new ApiError("An identity is already published", 409);
    const list = await verifyDeviceList(data.deviceList, data.identityKey, { expectedUserId: ME });
    server.set(ME, { identityKey: data.identityKey, deviceList: { version: list.version, ...data.deviceList } });
    return server.get(ME);
  });
  publishDeviceList.mockReset().mockImplementation(async (deviceList: { body: string; signature: string }) => {
    const current = server.get(ME)!;
    const list = await verifyDeviceList(deviceList, current.identityKey, { expectedUserId: ME });
    server.set(ME, { identityKey: current.identityKey, deviceList: { version: list.version, ...deviceList } });
    return server.get(ME);
  });
});

describe("ensureDeviceSigningKey", () => {
  it("creates one key for concurrent first callers, so the list never names a key this device lost", async () => {
    const [a, b, c] = await Promise.all([ensureDeviceSigningKey(ME), ensureDeviceSigningKey(ME), ensureDeviceSigningKey(ME)]);
    expect(b.publicKey).toBe(a.publicKey);
    expect(c.publicKey).toBe(a.publicKey);
    expect(store.data.get(deviceSigningKeyStorageKey(ME))).toBe(a.privateKey);
    expect((await ensureDeviceSigningKey(ME)).publicKey).toBe(a.publicKey);
  });
});

describe("bootstrapDeviceIdentity", () => {
  it("publishes an identity with this device on a fresh account, once", async () => {
    expect(await bootstrapDeviceIdentity(thisDevice())).toBe("trusted");

    const published = server.get(ME)!;
    const list = await verifyDeviceList(published.deviceList, published.identityKey, { expectedUserId: ME });
    expect(list.version).toBe(1);
    expect(list.devices.map((d) => d.deviceId)).toEqual(["device-a"]);
    expect(list.devices[0]!.encryptionPublicKey).toBe(encryptionPublicKey);
    expect(store.data.has(identityKeyStorageKey(ME))).toBe(true);

    // Signing in again changes nothing.
    expect(await bootstrapDeviceIdentity(thisDevice())).toBe("trusted");
    expect(publishIdentity).toHaveBeenCalledTimes(1);
    expect(publishDeviceList).not.toHaveBeenCalled();
  });

  it("leaves a new device pending when the account already has an identity", async () => {
    const identity = await generateSigningKeypair();
    await publishFor(ME, identity, 1, [await deviceEntry("device-other")]);

    expect(await bootstrapDeviceIdentity(thisDevice())).toBe("pending");
    expect(publishIdentity).not.toHaveBeenCalled();
    expect(publishDeviceList).not.toHaveBeenCalled();
    expect(store.data.has(identityKeyStorageKey(ME))).toBe(false);
  });

  it("drops its own new identity and goes pending when another device published first", async () => {
    const winner = await generateSigningKeypair();
    publishIdentity.mockImplementationOnce(async () => {
      await publishFor(ME, winner, 1, [await deviceEntry("device-other")]);
      throw new ApiError("An identity is already published", 409);
    });

    expect(await bootstrapDeviceIdentity(thisDevice())).toBe("pending");
    expect(store.data.has(identityKeyStorageKey(ME))).toBe(false);
    expect(server.get(ME)!.identityKey).toBe(winner.publicKey);
  });

  it("reports a conflict, and publishes nothing, when it holds a different identity than the account", async () => {
    const accountIdentity = await generateSigningKeypair();
    await publishFor(ME, accountIdentity, 1, [await deviceEntry("device-other")]);
    store.data.set(identityKeyStorageKey(ME), (await generateSigningKeypair()).privateKey);

    expect(await bootstrapDeviceIdentity(thisDevice())).toBe("conflict");
    expect(publishIdentity).not.toHaveBeenCalled();
    expect(publishDeviceList).not.toHaveBeenCalled();
  });

  it("refuses a list older than one it already saw (server rollback)", async () => {
    await bootstrapDeviceIdentity(thisDevice());
    const identityPrivateKey = store.data.get(identityKeyStorageKey(ME))!;
    const identity = { privateKey: identityPrivateKey, publicKey: server.get(ME)!.identityKey };
    const v1 = server.get(ME)!;

    // A second device is added (v2), then the server serves v1 again.
    const entry = (await verifyDeviceList(v1.deviceList, v1.identityKey, { expectedUserId: ME })).devices[0]!;
    await publishFor(ME, identity, 2, [entry, await deviceEntry("device-b")]);
    await bootstrapDeviceIdentity(thisDevice());
    server.set(ME, v1);

    await expect(bootstrapDeviceIdentity(thisDevice())).rejects.toThrow(/older/);
  });

  it("refuses a list the server forged under its own identity key", async () => {
    await bootstrapDeviceIdentity(thisDevice());
    const forger = await generateSigningKeypair();
    const forged = await signDeviceList({ userId: ME, version: 9, devices: [await deviceEntry("device-server")] }, forger.privateKey);
    server.set(ME, { identityKey: server.get(ME)!.identityKey, deviceList: { version: 9, ...forged } });

    await expect(bootstrapDeviceIdentity(thisDevice())).rejects.toThrow(/signature is invalid/);
  });

  it("re-lists itself under its current keys and keeps the other devices", async () => {
    await bootstrapDeviceIdentity(thisDevice());
    const identity = { privateKey: store.data.get(identityKeyStorageKey(ME))!, publicKey: server.get(ME)!.identityKey };
    const other = await deviceEntry("device-b");
    const stale = { ...(await deviceEntry("device-a")), addedAt: 42 };
    await publishFor(ME, identity, 2, [stale, other]);

    expect(await bootstrapDeviceIdentity(thisDevice())).toBe("trusted");

    const list = await verifyDeviceList(server.get(ME)!.deviceList, identity.publicKey, { expectedUserId: ME });
    expect(list.version).toBe(3);
    expect(list.devices.find((d) => d.deviceId === "device-b")).toEqual(other);
    const self = list.devices.find((d) => d.deviceId === "device-a")!;
    expect(self.encryptionPublicKey).toBe(encryptionPublicKey);
    expect(self.addedAt).toBe(42);
  });

  it("re-publishes its identity above the last version it saw if the server lost it", async () => {
    await bootstrapDeviceIdentity(thisDevice());
    const identityKey = server.get(ME)!.identityKey;
    server.clear();

    expect(await bootstrapDeviceIdentity(thisDevice())).toBe("trusted");
    expect(server.get(ME)!.identityKey).toBe(identityKey);
    expect(server.get(ME)!.deviceList.version).toBe(2);
  });
});

describe("getContactDevices", () => {
  let contactIdentity: { privateKey: string; publicKey: string };
  let phone: DeviceListEntry;

  beforeEach(async () => {
    contactIdentity = await generateSigningKeypair();
    phone = await deviceEntry("phone");
    await publishFor(CONTACT, contactIdentity, 1, [phone]);
  });

  it("pins the identity on first sight", async () => {
    const result = await getContactDevices(ME, CONTACT, "t");
    expect(result).toMatchObject({ status: "verified", firstSeen: true, version: 1, addedDevices: [] });
    expect(result.status === "verified" && result.devices).toEqual([phone]);
  });

  it("reports devices added since last time", async () => {
    await getContactDevices(ME, CONTACT, "t");
    const laptop = await deviceEntry("laptop");
    await publishFor(CONTACT, contactIdentity, 2, [phone, laptop]);

    const result = await getContactDevices(ME, CONTACT, "t");
    expect(result).toMatchObject({ status: "verified", firstSeen: false, addedDevices: [laptop] });
  });

  it("flags a changed identity key and keeps the old pin until the user accepts it", async () => {
    await getContactDevices(ME, CONTACT, "t");
    const replacement = await generateSigningKeypair();
    await publishFor(CONTACT, replacement, 5, [await deviceEntry("server-device")]);

    const flagged = await getContactDevices(ME, CONTACT, "t");
    expect(flagged).toEqual({
      status: "identity-changed",
      pinnedIdentityKey: contactIdentity.publicKey,
      currentIdentityKey: replacement.publicKey,
    });
    // Asking again doesn't quietly re-pin.
    expect((await getContactDevices(ME, CONTACT, "t")).status).toBe("identity-changed");

    await acceptContactIdentity(ME, CONTACT, replacement.publicKey);
    expect((await getContactDevices(ME, CONTACT, "t")).status).toBe("verified");
  });

  it("refuses a rolled-back list", async () => {
    const v1 = server.get(CONTACT)!;
    await publishFor(CONTACT, contactIdentity, 2, [phone, await deviceEntry("laptop")]);
    await getContactDevices(ME, CONTACT, "t");
    server.set(CONTACT, v1);

    await expect(getContactDevices(ME, CONTACT, "t")).rejects.toThrow(/older/);
  });

  it("refuses two different lists signed under the same version", async () => {
    await getContactDevices(ME, CONTACT, "t");
    await publishFor(CONTACT, contactIdentity, 1, [phone, await deviceEntry("extra")]);

    await expect(getContactDevices(ME, CONTACT, "t")).rejects.toThrow(/without a new version/);
  });

  it("refuses a list not signed by the pinned identity", async () => {
    await getContactDevices(ME, CONTACT, "t");
    const forger = await generateSigningKeypair();
    const forged = await signDeviceList({ userId: CONTACT, version: 2, devices: [phone, await deviceEntry("server-device")] }, forger.privateKey);
    server.set(CONTACT, { identityKey: contactIdentity.publicKey, deviceList: { version: 2, ...forged } });

    await expect(getContactDevices(ME, CONTACT, "t")).rejects.toThrow(/signature is invalid/);
  });

  it("refuses another user's valid list served for this contact", async () => {
    const otherIdentity = await generateSigningKeypair();
    await publishFor("user-other", otherIdentity, 1, [phone]);
    server.set(CONTACT, server.get("user-other")!);

    await expect(getContactDevices(ME, CONTACT, "t")).rejects.toThrow(/different user/);
  });

  it("reports contacts without an identity", async () => {
    expect(await getContactDevices(ME, "user-nobody", "t")).toEqual({ status: "no-identity" });
  });

  it("keeps every pin when contacts are checked concurrently", async () => {
    const others = ["c1", "c2", "c3", "c4"];
    for (const id of others) await publishFor(id, await generateSigningKeypair(), 1, [await deviceEntry(`${id}-d`)]);

    await Promise.all(others.map((id) => getContactDevices(ME, id, "t")));

    const pins = JSON.parse(store.data.get(`orbit:identityPins:${ME}`)!);
    expect(Object.keys(pins).sort()).toEqual(others);
  });
});


describe("a device removed from the list (B8)", () => {
  it("drops the identity it still holds and becomes an ordinary unlinked device, never re-adding itself", async () => {
    const identity = await generateSigningKeypair();
    await store.set(identityKeyStorageKey(ME), identity.privateKey);
    await publishFor(ME, identity, 3, [await deviceEntry("other-device")]);

    expect(await bootstrapDeviceIdentity(thisDevice("device-a"))).toBe("pending");
    expect(store.data.has(identityKeyStorageKey(ME))).toBe(false);
    expect(publishDeviceList).not.toHaveBeenCalled();
  });
});

describe("resetOwnIdentity (B10)", () => {
  it("publishes a new identity with a newer list naming only this device, then holds it", async () => {
    const old = await generateSigningKeypair();
    await publishFor(ME, old, 4, [await deviceEntry("lost-desktop")]);
    resetIdentity.mockReset().mockImplementation(async (data: { identityKey: string; deviceList: { body: string; signature: string } }) => {
      const list = await verifyDeviceList(data.deviceList, data.identityKey, { expectedUserId: ME });
      server.set(ME, { identityKey: data.identityKey, deviceList: { version: list.version, ...data.deviceList } });
      return server.get(ME);
    });

    expect(await resetOwnIdentity(thisDevice("device-new"), { password: "pw", recoveryCode: "code" })).toBe("trusted");
    const sent = resetIdentity.mock.calls[0]![0] as { password: string; recoveryCode: string; identityKey: string; deviceList: { body: string; signature: string } };
    expect(sent).toMatchObject({ password: "pw", recoveryCode: "code" });
    const list = await verifyDeviceList(sent.deviceList, sent.identityKey, { expectedUserId: ME });
    expect(list.version).toBe(5);
    expect(list.devices.map((d) => d.deviceId)).toEqual(["device-new"]);
    expect(await signingPublicKeyOf(store.data.get(identityKeyStorageKey(ME))!)).toBe(sent.identityKey);
    // And the device now bootstraps as trusted against the new identity.
    expect(await bootstrapDeviceIdentity(thisDevice("device-new"))).toBe("trusted");
  });

  it("keeps nothing if the server refuses (wrong password or code)", async () => {
    await publishFor(ME, await generateSigningKeypair(), 1, [await deviceEntry("lost-desktop")]);
    resetIdentity.mockReset().mockRejectedValue(new ApiError("Invalid password", 401));
    await expect(resetOwnIdentity(thisDevice("device-new"), { password: "bad", recoveryCode: "code" })).rejects.toThrow("Invalid password");
    expect(store.data.has(identityKeyStorageKey(ME))).toBe(false);
  });
});

describe("verified contacts (B6)", () => {
  it("keeps the verified mark across list updates, drops it when the identity changes", async () => {
    const contactIdentity = await generateSigningKeypair();
    const phone = await deviceEntry("phone");
    await publishFor(CONTACT, contactIdentity, 1, [phone]);
    await getContactDevices(ME, CONTACT, "t");
    await markContactVerified(ME, CONTACT, contactIdentity.publicKey);
    expect(await isContactVerified(ME, CONTACT)).toBe(true);

    await publishFor(CONTACT, contactIdentity, 2, [phone, await deviceEntry("laptop")]);
    await getContactDevices(ME, CONTACT, "t");
    expect(await isContactVerified(ME, CONTACT)).toBe(true);

    const replacement = await generateSigningKeypair();
    await publishFor(CONTACT, replacement, 3, [phone]);
    await acceptContactIdentity(ME, CONTACT, replacement.publicKey);
    expect(await isContactVerified(ME, CONTACT)).toBe(false);
  });

  it("refuses to verify a key that isn't the pinned one", async () => {
    const contactIdentity = await generateSigningKeypair();
    await publishFor(CONTACT, contactIdentity, 1, [await deviceEntry("phone")]);
    await getContactDevices(ME, CONTACT, "t");
    await expect(markContactVerified(ME, CONTACT, (await generateSigningKeypair()).publicKey)).rejects.toThrow(/changed/);
    expect(await isContactVerified(ME, CONTACT)).toBe(false);
  });
});
