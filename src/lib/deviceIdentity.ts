import * as api from "./api";
import { sha256Base64 } from "./crypto";
import {
  generateSigningKeypair,
  signDeviceList,
  signingPublicKeyFromPrivateKey,
  verifyDeviceList,
  type DeviceList,
  type DeviceListEntry,
  type SignedDeviceList,
} from "./deviceTrust";
import { getPlatform } from "../platform";

/**
 * This device's place in its user's signed device list, and the identity keys pinned for
 * contacts (mobile plan B6). With per-device keys on (B1), these verified lists are the only
 * source of who conversation keys are sealed to and whose key envelopes are believed
 * (`src/lib/conversationKeys.ts`).
 */

/** Where secrets live in the platform's secure store. Per user, like the device encryption key. */
export const deviceSigningKeyStorageKey = (userId: string) => `orbit:deviceSigningKey:${userId}`;
export const identityKeyStorageKey = (userId: string) => `orbit:identityKey:${userId}`;
export const ownListVersionStorageKey = (userId: string) => `orbit:deviceListVersion:${userId}`;
export const pinsStorageKey = (myUserId: string) => `orbit:identityPins:${myUserId}`;

/**
 * - `trusted`: this device is on the user's signed device list.
 * - `pending`: the account already has an identity this device doesn't hold, so it has to be
 *   linked from a trusted device (B7) before it gets chat keys.
 * - `conflict`: this device holds an identity key that isn't the account's. Never overwritten
 *   automatically; resolving it is the identity-reset flow (B10).
 */
export type DeviceIdentityStatus = "trusted" | "pending" | "conflict";

export type ThisDevice = {
  userId: string;
  /** The server's Device row ID, from the access token's `deviceId` claim. */
  deviceId: string;
  deviceName: string;
  /** X25519 public key that conversation keys will be sealed to. */
  encryptionPublicKey: string;
  token: string;
};

const signingKeyInFlight = new Map<string, Promise<{ privateKey: string; publicKey: string }>>();

/**
 * The device's Ed25519 signing key, created on first use. Concurrent first calls share one
 * creation: two would each store a different key, and the list could end up naming the one
 * that lost, so every envelope this device signs would fail verification.
 */
export function ensureDeviceSigningKey(userId: string) {
  const pending = signingKeyInFlight.get(userId);
  if (pending) return pending;
  const run = (async () => {
    const store = getPlatform().secureStore;
    const existing = await store.get(deviceSigningKeyStorageKey(userId));
    if (existing) {
      return { privateKey: existing, publicKey: await signingPublicKeyFromPrivateKey(existing) };
    }
    const created = await generateSigningKeypair();
    await store.set(deviceSigningKeyStorageKey(userId), created.privateKey);
    return created;
  })().finally(() => signingKeyInFlight.delete(userId));
  signingKeyInFlight.set(userId, run);
  return run;
}

async function readVersion(key: string) {
  const raw = await getPlatform().secureStore.get(key);
  const value = raw === null ? 0 : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Raise the stored version floor, never lower it (two concurrent readers may finish out of order). */
const floorWrites = new Map<string, Promise<unknown>>();
function raiseVersionFloor(key: string, version: number) {
  const run = (floorWrites.get(key) ?? Promise.resolve()).then(async () => {
    if (version > (await readVersion(key))) await getPlatform().secureStore.set(key, String(version));
  });
  floorWrites.set(key, run.catch(() => undefined));
  return run;
}

/**
 * Make sure this device is on its user's signed device list, publishing the identity on the
 * account's first upgraded device. Safe to call on every sign-in.
 */
export async function bootstrapDeviceIdentity(device: ThisDevice): Promise<DeviceIdentityStatus> {
  const store = getPlatform().secureStore;
  const signing = await ensureDeviceSigningKey(device.userId);
  const self: DeviceListEntry = {
    deviceId: device.deviceId,
    encryptionPublicKey: device.encryptionPublicKey,
    signingPublicKey: signing.publicKey,
    name: device.deviceName,
    addedAt: Date.now(),
  };

  let server = await api.getMyIdentity(device.token);
  let identityPrivateKey = await store.get(identityKeyStorageKey(device.userId));

  if (!server) {
    // No identity on the account yet. Store a new one before publishing: if storing came second
    // and failed, the account would be left with an identity nobody holds.
    const generated = !identityPrivateKey;
    if (!identityPrivateKey) {
      identityPrivateKey = (await generateSigningKeypair()).privateKey;
      await store.set(identityKeyStorageKey(device.userId), identityPrivateKey);
    }
    const version = (await readVersion(ownListVersionStorageKey(device.userId))) + 1;
    const deviceList = await signDeviceList({ userId: device.userId, version, devices: [self] }, identityPrivateKey);
    try {
      await api.publishIdentity(
        { identityKey: await signingPublicKeyFromPrivateKey(identityPrivateKey), deviceList },
        device.token
      );
      await store.set(ownListVersionStorageKey(device.userId), String(version));
      return "trusted";
    } catch (err) {
      if (!(err instanceof api.ApiError && err.status === 409)) throw err;
      // Another device published first. A key generated just now was never anyone's identity,
      // so drop it and continue as a device of the identity that won.
      if (generated) {
        await store.remove(identityKeyStorageKey(device.userId));
        identityPrivateKey = null;
      }
      server = await api.getMyIdentity(device.token);
      if (!server) throw err;
    }
  }

  if (!identityPrivateKey) return "pending";
  if ((await signingPublicKeyFromPrivateKey(identityPrivateKey)) !== server.identityKey) return "conflict";

  // We hold the identity key, but still check the list: the server must not be able to serve an
  // older list (one still containing a revoked device) without this device noticing.
  const list = await verifyDeviceList(server.deviceList, server.identityKey, {
    expectedUserId: device.userId,
    minVersion: await readVersion(ownListVersionStorageKey(device.userId)),
  });
  await raiseVersionFloor(ownListVersionStorageKey(device.userId), list.version);

  const listed = list.devices.find((d) => d.deviceId === device.deviceId);
  if (
    listed &&
    listed.encryptionPublicKey === self.encryptionPublicKey &&
    listed.signingPublicKey === self.signingPublicKey
  ) {
    return "trusted";
  }
  if (!listed) {
    // Every device that holds the identity got onto the list when it got the identity, so not
    // being on it means this device was removed (B8). Never add itself back: drop the identity
    // and become an ordinary unlinked device that can be linked again.
    await store.remove(identityKeyStorageKey(device.userId));
    return "pending";
  }

  // This device holds the identity and is listed, but with other keys (e.g. an old encryption
  // key): publish the next version with its current keys.
  const next: DeviceList = {
    userId: device.userId,
    version: list.version + 1,
    devices: [...list.devices.filter((d) => d.deviceId !== device.deviceId), { ...self, addedAt: listed.addedAt }],
  };
  await api.publishDeviceList(await signDeviceList(next, identityPrivateKey), device.token);
  await raiseVersionFloor(ownListVersionStorageKey(device.userId), next.version);
  return "trusted";
}

/**
 * Reset the account's identity from this device (B10: every linked device is lost). Needs the
 * password and a recovery code. This device becomes the only one on a new list; contacts see an
 * identity change and must review it before they seal keys to this user again. History sealed to
 * the lost devices is gone.
 */
export async function resetOwnIdentity(device: ThisDevice, credentials: { password: string; recoveryCode: string }): Promise<DeviceIdentityStatus> {
  const store = getPlatform().secureStore;
  const signing = await ensureDeviceSigningKey(device.userId);
  const identity = await generateSigningKeypair();
  const current = await api.getMyIdentity(device.token);
  const version = Math.max(current?.deviceList.version ?? 0, await readVersion(ownListVersionStorageKey(device.userId))) + 1;
  const deviceList = await signDeviceList(
    {
      userId: device.userId,
      version,
      devices: [
        {
          deviceId: device.deviceId,
          encryptionPublicKey: device.encryptionPublicKey,
          signingPublicKey: signing.publicKey,
          name: device.deviceName,
          addedAt: Date.now(),
        },
      ],
    },
    identity.privateKey
  );
  await api.resetIdentity({ ...credentials, identityKey: identity.publicKey, deviceList }, device.token);
  // Only after the server took it: the old key (if any) wasn't the account's either way.
  await store.set(identityKeyStorageKey(device.userId), identity.privateKey);
  await raiseVersionFloor(ownListVersionStorageKey(device.userId), version);
  return "trusted";
}

/** This user's identity public key, if this device holds the identity (it is or was trusted). */
export async function ownIdentityPublicKey(userId: string) {
  const identityPrivateKey = await getPlatform().secureStore.get(identityKeyStorageKey(userId));
  return identityPrivateKey ? signingPublicKeyFromPrivateKey(identityPrivateKey) : null;
}

/**
 * The user's own current device list, verified against the identity key this device holds and
 * the highest version it has seen. Throws on a device that doesn't hold the identity (pending),
 * so callers can't fall back to whatever the server says.
 */
export async function getOwnDevices(userId: string, token: string): Promise<DeviceList> {
  const identityKey = await ownIdentityPublicKey(userId);
  if (!identityKey) throw new Error("This device isn't linked to your account yet.");
  const server = await api.getMyIdentity(token);
  if (!server) throw new Error("Your account has no device list.");
  if (server.identityKey !== identityKey) throw new Error("Your account's security key doesn't match this device.");
  const list = await verifyDeviceList(server.deviceList, identityKey, {
    expectedUserId: userId,
    minVersion: await readVersion(ownListVersionStorageKey(userId)),
  });
  await raiseVersionFloor(ownListVersionStorageKey(userId), list.version);
  return list;
}

/**
 * Publish the next version of this user's device list, changed by `change` (add a device when
 * linking, B7; drop one when revoking, B8). Needs the identity key, so only a trusted device can.
 * Retries once if another device published a version in between.
 */
export async function publishDeviceListChange(
  userId: string,
  token: string,
  change: (current: DeviceList) => DeviceListEntry[]
): Promise<{ list: DeviceList; signed: SignedDeviceList }> {
  const identityPrivateKey = await getPlatform().secureStore.get(identityKeyStorageKey(userId));
  if (!identityPrivateKey) throw new Error("This device isn't linked to your account, so it can't change your devices.");
  for (let attempt = 0; ; attempt += 1) {
    const current = await getOwnDevices(userId, token);
    const next: DeviceList = { userId, version: current.version + 1, devices: change(current) };
    const signed = await signDeviceList(next, identityPrivateKey);
    try {
      await api.publishDeviceList(signed, token);
      await raiseVersionFloor(ownListVersionStorageKey(userId), next.version);
      return { list: next, signed };
    } catch (err) {
      if (attempt === 0 && err instanceof api.ApiError && err.status === 409) continue;
      throw err;
    }
  }
}

/**
 * A linked device takes on the identity it was handed (B7). Refuses to replace a different
 * identity this device already holds: that's the conflict state, resolved only by a reset (B10).
 */
export async function adoptLinkedIdentity(userId: string, identityPrivateKey: string, listVersion: number) {
  const store = getPlatform().secureStore;
  const existing = await store.get(identityKeyStorageKey(userId));
  if (existing && existing !== identityPrivateKey) throw new Error("This device already holds a different security key for your account.");
  if (!existing) await store.set(identityKeyStorageKey(userId), identityPrivateKey);
  await raiseVersionFloor(ownListVersionStorageKey(userId), listVersion);
}

/** The highest own-list version this device has seen (for refusing a rolled-back list in a welcome). */
export function ownListVersionFloor(userId: string) {
  return readVersion(ownListVersionStorageKey(userId));
}

// ─── Contacts: pinned identity keys (trust on first use) ──

type Pin = {
  identityKey: string;
  /** The user compared safety numbers and marked this identity verified. Dropped when it changes. */
  verified?: boolean;
  /** Highest device list version accepted for this contact. */
  version: number;
  /** Digest of that version's body, to catch two different lists with the same version. */
  bodyDigest: string;
  deviceIds: string[];
};

export type ContactDevices =
  | { status: "no-identity" }
  | {
      status: "verified";
      identityKey: string;
      version: number;
      devices: DeviceListEntry[];
      /** Devices not on the list last time, for a "new device" notice. Empty on first sight. */
      addedDevices: DeviceListEntry[];
      /** IDs of devices on the list last time but not now (revoked): shared chats must rotate (B8). */
      removedDeviceIds: string[];
      firstSeen: boolean;
    }
  | {
      /** The contact's identity key is not the pinned one. Nothing may be sealed to them until accepted. */
      status: "identity-changed";
      pinnedIdentityKey: string;
      currentIdentityKey: string;
    };

type DevicesRemovedListener = (contactUserId: string, removedDeviceIds: string[]) => void;
const devicesRemovedListeners = new Set<DevicesRemovedListener>();

/**
 * Called when a contact's verified list no longer has devices it had (B8: they revoked one). Chats
 * shared with them must rotate before the next send, whatever the server says.
 */
export function onContactDevicesRemoved(listener: DevicesRemovedListener) {
  devicesRemovedListeners.add(listener);
  return () => void devicesRemovedListeners.delete(listener);
}

type DevicesAddedListener = (contactUserId: string, added: DeviceListEntry[]) => void;
const devicesAddedListeners = new Set<DevicesAddedListener>();

/** Called when a contact's verified list gains devices, for the "added a new device" notice (B6). */
export function onContactDevicesAdded(listener: DevicesAddedListener) {
  devicesAddedListeners.add(listener);
  return () => void devicesAddedListeners.delete(listener);
}

// Pins for one signed-in user live in one record, so updates are serialized to avoid lost writes.
const pinWrites = new Map<string, Promise<unknown>>();

function withPins<T>(myUserId: string, fn: (pins: Record<string, Pin>) => Promise<T>) {
  const run = (pinWrites.get(myUserId) ?? Promise.resolve()).then(async () => {
    const store = getPlatform().secureStore;
    const raw = await store.get(pinsStorageKey(myUserId));
    const pins = raw ? (JSON.parse(raw) as Record<string, Pin>) : {};
    const before = JSON.stringify(pins);
    const result = await fn(pins);
    const after = JSON.stringify(pins);
    if (after !== before) await store.set(pinsStorageKey(myUserId), after);
    return result;
  });
  pinWrites.set(myUserId, run.catch(() => undefined));
  return run;
}

/**
 * A contact's devices, verified against the identity key pinned for them. Throws if the server
 * serves a forged, rolled-back or equivocating list; callers must treat that as "seal to nobody".
 */
export async function getContactDevices(myUserId: string, contactUserId: string, token: string): Promise<ContactDevices> {
  // Fetched outside the pin lock so lookups for different contacts run in parallel; only the
  // compare-and-update of the pin is serialized.
  const server = await api.getUserIdentity(contactUserId, token);
  const result = await withPins(myUserId, async (pins): Promise<ContactDevices> => {
    if (!server) return { status: "no-identity" } as const;

    const pin = pins[contactUserId];
    if (pin && pin.identityKey !== server.identityKey) {
      return {
        status: "identity-changed",
        pinnedIdentityKey: pin.identityKey,
        currentIdentityKey: server.identityKey,
      } as const;
    }

    const list = await verifyDeviceList(server.deviceList, server.identityKey, {
      expectedUserId: contactUserId,
      minVersion: pin?.version ?? 0,
    });
    const bodyDigest = await sha256Base64(new TextEncoder().encode(server.deviceList.body));
    if (pin && list.version === pin.version && bodyDigest !== pin.bodyDigest) {
      throw new Error("Contact's device list changed without a new version");
    }

    const known = new Set(pin?.deviceIds ?? []);
    const current = new Set(list.devices.map((d) => d.deviceId));
    pins[contactUserId] = {
      ...(pin?.verified ? { verified: true } : {}),
      identityKey: server.identityKey,
      version: list.version,
      bodyDigest,
      deviceIds: list.devices.map((d) => d.deviceId),
    };
    return {
      status: "verified",
      identityKey: server.identityKey,
      version: list.version,
      devices: list.devices,
      addedDevices: pin ? list.devices.filter((d) => !known.has(d.deviceId)) : [],
      removedDeviceIds: [...known].filter((id) => !current.has(id)),
      firstSeen: !pin,
    } as const;
  });
  if (result.status === "verified" && result.addedDevices.length) {
    for (const listener of devicesAddedListeners) {
      try {
        listener(contactUserId, result.addedDevices);
      } catch {
        // A listener's failure must not fail the lookup.
      }
    }
  }
  if (result.status === "verified" && result.removedDeviceIds.length) {
    for (const listener of devicesRemovedListeners) {
      try {
        listener(contactUserId, result.removedDeviceIds);
      } catch {
        // A listener's failure must not fail the lookup.
      }
    }
  }
  return result;
}

/** The identity key pinned for a contact, or null before first sight. */
export function pinnedIdentityKey(myUserId: string, contactUserId: string) {
  return withPins(myUserId, async (pins) => pins[contactUserId]?.identityKey ?? null);
}

/**
 * The user saw the identity-change warning and accepted the contact's new identity key. A
 * verified mark doesn't carry over: the new key hasn't been compared.
 */
export function acceptContactIdentity(myUserId: string, contactUserId: string, identityKey: string) {
  return withPins(myUserId, async (pins) => {
    pins[contactUserId] = { identityKey, version: 0, bodyDigest: "", deviceIds: [] };
  });
}

/**
 * Mark a contact verified after comparing safety numbers, for the identity key that was compared.
 * Refused if that's no longer the pinned key (it changed while the screen was open).
 */
export function markContactVerified(myUserId: string, contactUserId: string, identityKey: string, verified = true) {
  return withPins(myUserId, async (pins) => {
    const pin = pins[contactUserId];
    if (!pin || pin.identityKey !== identityKey) throw new Error("Their security key changed. Compare the new safety number first.");
    if (verified) pin.verified = true;
    else delete pin.verified;
  });
}

/** Whether the user verified this contact's current pinned identity. */
export function isContactVerified(myUserId: string, contactUserId: string) {
  return withPins(myUserId, async (pins) => pins[contactUserId]?.verified === true);
}

/**
 * A device that has left its user's list (revoked or replaced), from the newest list that named
 * it, verified against the identity key pinned for that user (or held, for this user). Only for
 * checking keys it issued in the past: never seal to it or accept a current key from it.
 * Null when no list signed by the pinned identity named it.
 */
export async function getFormerDevice(
  myUserId: string,
  ownerUserId: string,
  deviceId: string,
  token: string
): Promise<DeviceListEntry | null> {
  const identityKey =
    ownerUserId === myUserId ? await ownIdentityPublicKey(myUserId) : await pinnedIdentityKey(myUserId, ownerUserId);
  if (!identityKey) return null;
  const server = await api.getDeviceListContaining(ownerUserId, deviceId, token);
  if (!server || server.identityKey !== identityKey) return null;
  try {
    const list = await verifyDeviceList(server.deviceList, identityKey, { expectedUserId: ownerUserId });
    return list.devices.find((d) => d.deviceId === deviceId) ?? null;
  } catch {
    return null;
  }
}
