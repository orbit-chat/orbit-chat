import * as api from "./api";
import { openSealedWithKeypair, sealToPublicKey } from "./crypto";
import { getContactDevices, getFormerDevice, getOwnDevices, pinnedIdentityKey } from "./deviceIdentity";
import { signKeyEnvelope, verifyKeyEnvelope, type DeviceListEntry } from "./deviceTrust";

/**
 * Per-device conversation keys (mobile plan B1, B5): who a key is sealed to, and which sealed
 * keys this device believes.
 *
 * The server is untrusted for key distribution. Recipients come only from device lists verified
 * against identity keys this device holds or pinned, and an envelope is opened only if its
 * signature verifies against the issuing device's key from such a list. The server's own checks
 * (`DeviceKeysService`) are a backstop, not the reason anything here is safe.
 *
 * The one exception is the move off legacy per-user rows: those are unsigned, so they are
 * trusted once, at upgrade, and never after (see `planLegacyMove`).
 */

export type ThisDeviceKeys = {
  userId: string;
  /** The server's Device row ID (the access token's `deviceId` claim). */
  deviceId: string;
  encryption: { publicKey: string; privateKey: string };
  signingPrivateKey: string;
};

export type KeyRecipient = { userId: string; username: string };

/** Why keys couldn't be sealed for someone. The message is meant for the user. */
export class KeyDistributionError extends Error {
  constructor(
    message: string,
    readonly reason: "no-identity" | "identity-changed" | "unverifiable",
    readonly userId: string
  ) {
    super(message);
    this.name = "KeyDistributionError";
  }
}

const LOOKUP_CONCURRENCY = 6;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Every linked device of every member, from freshly fetched lists verified against the identity
 * this device holds (for its own user) or the identities pinned for contacts. Throws a
 * `KeyDistributionError` naming the first member who can't be sealed to: no identity yet (an
 * outdated app), an identity change the user hasn't reviewed (§4 decision 6), or a list that
 * doesn't verify. Sealing to a subset would silently lock that member out, so there is no partial result.
 */
export async function resolveMemberDevices(params: {
  myUserId: string;
  token: string;
  members: KeyRecipient[];
}): Promise<DeviceListEntry[]> {
  const unique = [...new Map(params.members.map((m) => [m.userId, m])).values()];
  if (!unique.some((m) => m.userId === params.myUserId)) {
    unique.push({ userId: params.myUserId, username: "" });
  }
  const perMember = await mapPool(unique, LOOKUP_CONCURRENCY, async (member) => {
    if (member.userId === params.myUserId) {
      return (await getOwnDevices(params.myUserId, params.token)).devices;
    }
    let contact;
    try {
      contact = await getContactDevices(params.myUserId, member.userId, params.token);
    } catch {
      throw new KeyDistributionError(
        `@${member.username}'s devices couldn't be verified, so nothing was sent to them. Try again later.`,
        "unverifiable",
        member.userId
      );
    }
    if (contact.status === "no-identity") {
      throw new KeyDistributionError(
        `@${member.username} needs to update Orbit before they can get keys for secure chats.`,
        "no-identity",
        member.userId
      );
    }
    if (contact.status === "identity-changed") {
      throw new KeyDistributionError(
        `@${member.username}'s security key changed. Review it before sending them keys.`,
        "identity-changed",
        member.userId
      );
    }
    return contact.devices;
  });
  return perMember.flat();
}

/** Seal one key version to each device and sign each envelope with this device's signing key. */
export async function sealForDevices(params: {
  conversationId: string;
  keyVersion: number;
  secretKey: string;
  devices: DeviceListEntry[];
  signingPrivateKey: string;
}): Promise<api.DeviceKeyInput[]> {
  const out: api.DeviceKeyInput[] = [];
  const seen = new Set<string>();
  for (const device of params.devices) {
    if (seen.has(device.deviceId)) continue;
    seen.add(device.deviceId);
    const sealedKey = await sealToPublicKey(params.secretKey, device.encryptionPublicKey);
    const signature = await signKeyEnvelope(
      {
        conversationId: params.conversationId,
        keyVersion: params.keyVersion,
        recipientDeviceId: device.deviceId,
        sealedKey,
      },
      params.signingPrivateKey
    );
    out.push({ deviceId: device.deviceId, sealedKey, signature });
  }
  return out;
}

/**
 * Where issuers' signing keys come from. `current` is the user's verified current list (null if
 * it can't be verified). With `knownOnly`, it answers only for users this device already pinned
 * (or itself): a user who isn't in the chat must never be pinned, or believed, on first sight.
 * `former` finds a device that has since left its list, for history only, and only for users
 * already pinned.
 */
export type IssuerLookup = {
  current(userId: string, options: { knownOnly: boolean }): Promise<DeviceListEntry[] | null>;
  former(userId: string, deviceId: string): Promise<DeviceListEntry | null>;
};

/** Issuer lookups against the server, verified the same way as recipients, memoized per call site. */
export function networkIssuerLookup(myUserId: string, token: string): IssuerLookup {
  const current = new Map<string, Promise<DeviceListEntry[] | null>>();
  const former = new Map<string, Promise<DeviceListEntry | null>>();
  return {
    current(userId, { knownOnly }) {
      const key = `${userId}:${knownOnly}`;
      let pending = current.get(key);
      if (!pending) {
        pending = (async () => {
          try {
            if (userId === myUserId) return (await getOwnDevices(myUserId, token)).devices;
            if (knownOnly && !(await pinnedIdentityKey(myUserId, userId))) return null;
            const contact = await getContactDevices(myUserId, userId, token);
            return contact.status === "verified" ? contact.devices : null;
          } catch {
            return null;
          }
        })();
        current.set(key, pending);
      }
      return pending;
    },
    former(userId, deviceId) {
      const key = `${userId}:${deviceId}`;
      let pending = former.get(key);
      if (!pending) {
        pending = getFormerDevice(myUserId, userId, deviceId, token).catch(() => null);
        former.set(key, pending);
      }
      return pending;
    },
  };
}

export type OpenedKeys = {
  /** Every version this device opened and believes, history included. */
  byVersion: Record<number, string>;
  /** The newest version any row exists for, whether or not this device could use it. */
  newestVersion: number;
  /**
   * Whether `byVersion[newestVersion]` may be used to encrypt: a signed copy for this device,
   * issued by a device on the current list of this user or of a current member. Anything else
   * (unsigned, issued by a device that has left, issued by a former member, or missing) means
   * the conversation must be rotated before this device sends.
   */
  newestSendable: boolean;
  /** Versions opened from unsigned legacy rows (only while the legacy move is still pending). */
  legacyVersions: number[];
  /** Rows addressed to this device that were refused (bad or unverifiable signature, or didn't open). */
  rejected: number;
};

/**
 * Open the rows the server returned for this device. Rows for other devices are ignored; signed
 * rows are verified before opening; legacy rows are used only when `allowLegacy` is set.
 */
export async function openConversationKeys(params: {
  rows: api.ConversationKey[];
  conversation: { id: string; members: Array<{ userId: string }> };
  me: ThisDeviceKeys;
  allowLegacy: boolean;
  issuers: IssuerLookup;
}): Promise<OpenedKeys> {
  const { rows, conversation, me, allowLegacy, issuers } = params;
  const memberIds = new Set(conversation.members.map((m) => m.userId));
  const signed: Record<number, { key: string; fromCurrent: boolean }> = {};
  const legacy: Record<number, string> = {};
  let newestVersion = 0;
  let rejected = 0;

  const open = async (sealedKey: string) => {
    try {
      return await openSealedWithKeypair(sealedKey, me.encryption.publicKey, me.encryption.privateKey);
    } catch {
      return null;
    }
  };

  for (const row of rows) {
    const keyVersion = row.keyVersion;
    if (!Number.isInteger(keyVersion) || keyVersion < 1) continue;
    const isLegacy = row.deviceId === null || row.deviceId === undefined;
    if (!isLegacy && row.deviceId !== me.deviceId) continue;
    newestVersion = Math.max(newestVersion, keyVersion);

    if (isLegacy) {
      if (!allowLegacy) continue;
      const key = await open(row.encryptedGroupKey);
      if (key) legacy[keyVersion] = key;
      continue;
    }

    const { issuerDeviceId, signature, issuerUserId } = row;
    if (!issuerDeviceId || !signature || !issuerUserId) {
      rejected += 1;
      continue;
    }
    const envelope = {
      conversationId: conversation.id,
      keyVersion,
      recipientDeviceId: me.deviceId,
      sealedKey: row.encryptedGroupKey,
    };

    // Current members (and this user) are looked up as usual. Anyone else is believed only if
    // this device already knew them, e.g. a member who has since left; a stranger the server
    // names as issuer is never pinned or believed, so it can't inject history.
    const issuerIsCurrent = issuerUserId === me.userId || memberIds.has(issuerUserId);
    let issuer =
      (await issuers.current(issuerUserId, { knownOnly: !issuerIsCurrent }))?.find((d) => d.deviceId === issuerDeviceId) ?? null;
    const fromCurrent = issuer !== null && issuerIsCurrent;
    // A device that has since left its list (or a member who has left the chat) can still vouch
    // for history it issued while it was there, but never for the key this device encrypts with.
    if (!issuer) issuer = await issuers.former(issuerUserId, issuerDeviceId);
    if (!issuer) {
      rejected += 1;
      continue;
    }

    let valid = false;
    try {
      valid = await verifyKeyEnvelope(envelope, signature, issuer.signingPublicKey);
    } catch {
      valid = false;
    }
    const key = valid ? await open(row.encryptedGroupKey) : null;
    if (!key) {
      rejected += 1;
      continue;
    }
    // Two signed rows for one version can only come from a misbehaving server; keep the one from
    // a current device if there is one.
    if (!signed[keyVersion] || (fromCurrent && !signed[keyVersion]!.fromCurrent)) {
      signed[keyVersion] = { key, fromCurrent };
    }
  }

  const byVersion: Record<number, string> = { ...legacy };
  for (const [version, entry] of Object.entries(signed)) byVersion[Number(version)] = entry.key;
  return {
    byVersion,
    newestVersion,
    newestSendable: signed[newestVersion]?.fromCurrent === true,
    legacyVersions: Object.keys(legacy)
      .map(Number)
      .filter((v) => !signed[v]),
    rejected,
  };
}

/**
 * The one-time move off legacy per-user rows for one conversation: open the legacy rows this
 * device can, and re-seal each version to every device on the user's own verified list, signed
 * by this device, for `POST /keys/device-batch` (write-once, so devices that already have a
 * version are skipped by the server). Versions below `minReadableKeyVersion` are left out, since
 * the server refuses them.
 *
 * Legacy rows are unsigned: the server (or, before B5, any member) could have written them. They
 * are trusted here once, at upgrade, the same way contacts' identity keys are pinned on first sight.
 */
export async function planLegacyMove(params: {
  conversationId: string;
  rows: api.ConversationKey[];
  minReadableKeyVersion: number;
  me: ThisDeviceKeys;
  ownDevices: DeviceListEntry[];
}): Promise<Array<api.DeviceKeyInput & { conversationId: string; keyVersion: number }>> {
  const { conversationId, rows, me } = params;
  const out: Array<api.DeviceKeyInput & { conversationId: string; keyVersion: number }> = [];
  const done = new Set<number>();
  for (const row of rows) {
    if (row.deviceId !== null && row.deviceId !== undefined) continue;
    if (!Number.isInteger(row.keyVersion) || row.keyVersion < params.minReadableKeyVersion || done.has(row.keyVersion)) continue;
    let secretKey: string;
    try {
      secretKey = await openSealedWithKeypair(row.encryptedGroupKey, me.encryption.publicKey, me.encryption.privateKey);
    } catch {
      continue; // sealed to another of this user's devices; that device moves it
    }
    done.add(row.keyVersion);
    const sealed = await sealForDevices({
      conversationId,
      keyVersion: row.keyVersion,
      secretKey,
      devices: params.ownDevices,
      signingPrivateKey: me.signingPrivateKey,
    });
    for (const key of sealed) out.push({ ...key, conversationId, keyVersion: row.keyVersion });
  }
  return out;
}
