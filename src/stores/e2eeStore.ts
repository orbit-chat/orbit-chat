import { create } from "zustand";
import * as api from "../lib/api";
import { getPlatform } from "../platform";
import { devLog } from "../lib/devLogger";
import {
  bootstrapDeviceIdentity,
  ensureDeviceSigningKey,
  getOwnDevices,
  type DeviceIdentityStatus,
} from "../lib/deviceIdentity";
import {
  generateKeypair,
  generateSecretKey,
  openSealedWithKeypair,
  publicKeyFromPrivateKey,
  sealToPublicKey,
} from "../lib/crypto";
import {
  networkIssuerLookup,
  openConversationKeys,
  planLegacyMove,
  type ThisDeviceKeys,
} from "../lib/conversationKeys";
import { deviceIdFromToken } from "../lib/jwt";
import { markPerDeviceKeysSeen } from "../lib/uiPreference";

function latestKey(keys: { publicKey: string; createdAt: string }[]) {
  if (!keys.length) return null;
  // keys are already ordered desc on the server, but keep this robust
  return keys
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]!
    .publicKey;
}

/** Where the device private key lives in the platform's secure store. Desktop installs already use this key. */
export function devicePrivateKeyStorageKey(userId: string) {
  return `orbit:privateKey:${userId}`;
}

/**
 * Set once this device has seen the server run per-device keys (mobile plan M1b). From then on it
 * never goes back to legacy per-user keys, whatever `GET /config/e2ee` says, so a server can't
 * downgrade it to keys nobody signed.
 */
export const perDeviceKeysStorageKey = (userId: string) => `orbit:perDeviceKeys:${userId}`;
/** Set once this device has moved its legacy per-user keys to signed per-device rows. Value: the device ID. */
export const legacyKeysMovedStorageKey = (userId: string) => `orbit:legacyKeysMoved:${userId}`;
/** A device that isn't on its user's signed device list can't open or send keys until it's linked (B7). */
export class DeviceNotLinkedError extends Error {
  constructor(readonly status: Exclude<DeviceIdentityStatus, "trusted">) {
    super(
      status === "pending"
        ? "Link this device from one of your other devices to read and send messages here."
        : "This device's security key doesn't match your account, so it can't read or send messages."
    );
    this.name = "DeviceNotLinkedError";
  }
}

const IDENTITY_RECHECK_MS = 30_000;

const conversationKeyLoadInFlight = new Map<string, Promise<string | null>>();
// Two callers racing on a fresh device would otherwise each generate and publish a keypair,
// leaving peers sealing keys to one this device no longer holds.
const deviceKeypairInFlight = new Map<string, Promise<{ publicKey: string; privateKey: string }>>();
const keyModeInFlight = new Map<string, Promise<boolean>>();
const identityInFlight = new Map<string, Promise<DeviceIdentityStatus>>();
const identityCheckedAt = new Map<string, number>();
const legacyMoveInFlight = new Map<string, Promise<boolean>>();

type E2EEState = {
  secretKeyByConversationId: Record<string, string>;
  secretKeyByConversationIdAndVersion: Record<string, Record<number, string>>;
  /** The newest key version that exists for each conversation (per-device), or the one in use (legacy). */
  keyVersionByConversationId: Record<string, number>;
  /**
   * Per-device keys: whether this device may encrypt with the newest version (a signed copy from
   * a current device). False means it rotates before sending.
   */
  sendableByConversationId: Record<string, boolean>;
  loadingByConversationId: Record<string, boolean>;
  errorByConversationId: Record<string, string | null>;
  publishedDeviceKeyByUserId: Record<string, boolean>;
  /** Whether this device is on the user's signed device list (mobile plan B6); null until checked. */
  deviceIdentityStatusByUserId: Record<string, DeviceIdentityStatus>;
  /** Which key protocol is in use for each signed-in user (mobile plan M1b). */
  perDeviceKeysByUserId: Record<string, boolean>;
  setDeviceIdentityStatus: (userId: string, status: DeviceIdentityStatus) => void;

  ensureDeviceKeypair: (userId: string, token: string) => Promise<{ publicKey: string; privateKey: string }>;
  /** Whether per-device keys are in use. Sticky: once on for this device, always on. */
  ensureKeyMode: (userId: string) => Promise<boolean>;
  /** Put this device on its user's signed device list if it holds the identity; report where it stands. */
  ensureDeviceIdentity: (userId: string, token: string, options?: { force?: boolean }) => Promise<DeviceIdentityStatus>;
  /** This device's keys for per-device sealing. Throws `DeviceNotLinkedError` if it isn't trusted. */
  thisDevice: (userId: string, token: string) => Promise<ThisDeviceKeys>;

  getConversationSecretKey: (conversationId: string) => string | null;
  getConversationSecretKeyForVersion: (conversationId: string, keyVersion?: number | null) => string | null;
  getConversationKeyVersion: (conversationId: string) => number | null;
  setConversationSecretKeyVersion: (params: {
    conversationId: string;
    keyVersion: number;
    secretKey: string;
    /** Per-device keys: this device issued it to every current device, so it may encrypt with it. */
    sendable?: boolean;
  }) => void;
  ensureConversationSecretKey: (params: {
    conversation: api.Conversation;
    token: string;
    myUserId: string;
    forceRefresh?: boolean;
  }) => Promise<string | null>;
  /**
   * The one-time move of this device's legacy per-user keys to signed per-device rows. Safe to
   * call on every sign-in; returns true once the move is done.
   */
  migrateLegacyKeys: (userId: string, token: string) => Promise<boolean>;
  /** Forget every key and status (sign-out). */
  reset: () => void;
};

const initialState = {
  secretKeyByConversationId: {},
  secretKeyByConversationIdAndVersion: {},
  keyVersionByConversationId: {},
  sendableByConversationId: {},
  loadingByConversationId: {},
  errorByConversationId: {},
  publishedDeviceKeyByUserId: {},
  deviceIdentityStatusByUserId: {},
  perDeviceKeysByUserId: {},
};

export const useE2EEStore = create<E2EEState>((set, get) => {
  const setLoading = (conversationId: string, loading: boolean, error?: string | null) =>
    set({
      loadingByConversationId: { ...get().loadingByConversationId, [conversationId]: loading },
      ...(error !== undefined ? { errorByConversationId: { ...get().errorByConversationId, [conversationId]: error } } : {}),
    });

  /** Merge opened versions into the cache; `best` becomes the conversation's current key. */
  const storeVersions = (
    conversationId: string,
    byVersion: Record<number, string>,
    keyVersion: number | null,
    extra: { sendable?: boolean } = {}
  ) => {
    // The current key is the highest version held, counting what was cached before this call.
    const merged = { ...(get().secretKeyByConversationIdAndVersion[conversationId] ?? {}), ...byVersion };
    const versions = Object.keys(merged)
      .map(Number)
      .sort((a, b) => b - a);
    const best = versions[0];
    set({
      secretKeyByConversationId:
        best !== undefined ? { ...get().secretKeyByConversationId, [conversationId]: merged[best]! } : get().secretKeyByConversationId,
      secretKeyByConversationIdAndVersion: { ...get().secretKeyByConversationIdAndVersion, [conversationId]: merged },
      keyVersionByConversationId:
        keyVersion !== null ? { ...get().keyVersionByConversationId, [conversationId]: keyVersion } : get().keyVersionByConversationId,
      ...(extra.sendable !== undefined
        ? { sendableByConversationId: { ...get().sendableByConversationId, [conversationId]: extra.sendable } }
        : {}),
      loadingByConversationId: { ...get().loadingByConversationId, [conversationId]: false },
    });
    return best !== undefined ? merged[best]! : null;
  };

  const legacyMoveDone = async (userId: string, deviceId: string) =>
    (await getPlatform().secureStore.get(legacyKeysMovedStorageKey(userId))) === deviceId;

  /** Per-device keys: verify and open this device's rows. */
  const loadPerDeviceKeys = async (conversation: api.Conversation, token: string, myUserId: string) => {
    const me = await get().thisDevice(myUserId, token);
    const rows = await api.getMyConversationKeys(conversation.id, token);
    const opened = await openConversationKeys({
      rows,
      conversation: { id: conversation.id, members: conversation.members.map((m) => ({ userId: m.userId })) },
      me,
      allowLegacy: !(await legacyMoveDone(myUserId, me.deviceId)),
      issuers: networkIssuerLookup(myUserId, token),
    });
    if (opened.rejected) {
      devLog.warn(`Refused ${opened.rejected} key(s) for conversation ${conversation.id}: signature missing, invalid or from an unknown device.`);
    }
    const key = storeVersions(conversation.id, opened.byVersion, opened.newestVersion || null, { sendable: opened.newestSendable });
    // No rows at all (a chat whose key was never issued) isn't an error: the first send issues one.
    if (!key && rows.some((r) => r.deviceId === me.deviceId || r.deviceId == null)) {
      throw new Error("This device doesn't have a key for this chat.");
    }
    return key;
  };

  /** Legacy per-user keys (the server's switch is off). Unchanged from before M1b. */
  const loadLegacyKeys = async (conversation: api.Conversation, token: string, myUserId: string) => {
    const { publicKey: myPublicKey, privateKey: myPrivateKey } = await get().ensureDeviceKeypair(myUserId, token);

    // 1) Try to fetch my encrypted conversation keys and decrypt the latest.
    const existingKeys = await api.getMyConversationKeys(conversation.id, token).catch(() => [] as api.ConversationKey[]);
    const orderedKeys = existingKeys.slice().sort((a, b) => (b.keyVersion ?? 0) - (a.keyVersion ?? 0));

    const decryptedByVersion: Record<number, string> = {};
    for (const candidate of orderedKeys) {
      if (!candidate.encryptedGroupKey) continue;
      try {
        decryptedByVersion[candidate.keyVersion ?? 1] = await openSealedWithKeypair(candidate.encryptedGroupKey, myPublicKey, myPrivateKey);
      } catch {
        // Try older keys when the latest key was encrypted for a different device.
      }
    }

    const availableVersions = Object.keys(decryptedByVersion)
      .map(Number)
      .filter((version) => Number.isFinite(version))
      .sort((a, b) => b - a);
    if (availableVersions.length > 0) {
      return storeVersions(conversation.id, decryptedByVersion, availableVersions[0]!);
    }

    // 2) No stored key yet: bootstrap one for DMs by encrypting a new secret key to each member.
    if (conversation.type !== "dm") throw new Error("Missing conversation key");
    const other = conversation.members.find((m) => m.user.id !== myUserId)?.user;
    if (!other?.id) throw new Error("Missing DM partner");
    const otherPublicKey = latestKey(await api.getUserKeys(other.id, token));
    if (!otherPublicKey) throw new Error("DM partner has no public key");

    const secretKey = await generateSecretKey();
    const nextKeyVersion = (orderedKeys[0]?.keyVersion ?? 0) + 1;
    await Promise.all([
      api.storeConversationKey(
        { conversationId: conversation.id, userId: myUserId, encryptedGroupKey: await sealToPublicKey(secretKey, myPublicKey), keyVersion: nextKeyVersion },
        token
      ),
      api.storeConversationKey(
        { conversationId: conversation.id, userId: other.id, encryptedGroupKey: await sealToPublicKey(secretKey, otherPublicKey), keyVersion: nextKeyVersion },
        token
      ),
    ]);
    return storeVersions(conversation.id, { [nextKeyVersion]: secretKey }, nextKeyVersion);
  };

  return {
    ...initialState,
    setDeviceIdentityStatus: (userId, status) =>
      set({ deviceIdentityStatusByUserId: { ...get().deviceIdentityStatusByUserId, [userId]: status } }),

    ensureDeviceKeypair: (userId, token) => {
      const pending = deviceKeypairInFlight.get(userId);
      if (pending) return pending;

      const load = (async () => {
        const store = getPlatform().secureStore;
        const existingPrivateKey = await store.get(devicePrivateKeyStorageKey(userId));
        if (existingPrivateKey) {
          const publicKey = await publicKeyFromPrivateKey(existingPrivateKey);
          if (!get().publishedDeviceKeyByUserId[userId]) {
            // Legacy key directory: the server stores each key once, so this only matters the
            // first time. Per-device sealing reads the signed device list instead.
            await api.addMyPublicKey(publicKey, token).catch(() => undefined);
            set({ publishedDeviceKeyByUserId: { ...get().publishedDeviceKeyByUserId, [userId]: true } });
          }
          return { publicKey, privateKey: existingPrivateKey };
        }

        // Create a new device keypair and register the public key.
        const keypair = await generateKeypair();
        await api.addMyPublicKey(keypair.publicKey, token);
        await store.set(devicePrivateKeyStorageKey(userId), keypair.privateKey);
        set({ publishedDeviceKeyByUserId: { ...get().publishedDeviceKeyByUserId, [userId]: true } });
        return keypair;
      })().finally(() => deviceKeypairInFlight.delete(userId));

      deviceKeypairInFlight.set(userId, load);
      return load;
    },

    ensureKeyMode: (userId) => {
      const known = get().perDeviceKeysByUserId[userId];
      if (known !== undefined) return Promise.resolve(known);
      const pending = keyModeInFlight.get(userId);
      if (pending) return pending;

      const load = (async () => {
        const store = getPlatform().secureStore;
        const sticky = (await store.get(perDeviceKeysStorageKey(userId))) === "1";
        let server: boolean | null = null;
        try {
          server = (await api.getE2eeConfig()).perDeviceKeys === true;
        } catch (err) {
          // A server from before M1b has no such endpoint: legacy keys. Anything else is unknown.
          if (err instanceof api.ApiError && err.status === 404) server = false;
        }
        if (server && !sticky) await store.set(perDeviceKeysStorageKey(userId), "1");
        if (sticky && server === false) {
          devLog.warn("The server reports legacy keys, but this device already uses per-device keys and won't go back.");
        }
        const perDevice = server === true || sticky;
        if (perDevice) markPerDeviceKeysSeen();
        // An unknown answer on a device that never saw per-device keys means legacy for now; ask again next time.
        if (server !== null || sticky) set({ perDeviceKeysByUserId: { ...get().perDeviceKeysByUserId, [userId]: perDevice } });
        return perDevice;
      })().finally(() => keyModeInFlight.delete(userId));

      keyModeInFlight.set(userId, load);
      return load;
    },

    ensureDeviceIdentity: (userId, token, options) => {
      const status = get().deviceIdentityStatusByUserId[userId];
      const checkedAt = identityCheckedAt.get(userId) ?? 0;
      if (!options?.force && status && (status === "trusted" || Date.now() - checkedAt < IDENTITY_RECHECK_MS)) {
        return Promise.resolve(status);
      }
      const pending = identityInFlight.get(userId);
      if (pending) return pending;

      const run = (async () => {
        const deviceId = deviceIdFromToken(token);
        if (!deviceId) throw new Error("This session has no device ID. Sign in again.");
        const { publicKey } = await get().ensureDeviceKeypair(userId, token);
        const result = await bootstrapDeviceIdentity({
          userId,
          deviceId,
          deviceName: getPlatform().deviceName,
          encryptionPublicKey: publicKey,
          token,
        });
        identityCheckedAt.set(userId, Date.now());
        get().setDeviceIdentityStatus(userId, result);
        return result;
      })().finally(() => identityInFlight.delete(userId));

      identityInFlight.set(userId, run);
      return run;
    },

    thisDevice: async (userId, token) => {
      const status = await get().ensureDeviceIdentity(userId, token);
      if (status !== "trusted") throw new DeviceNotLinkedError(status);
      const deviceId = deviceIdFromToken(token);
      if (!deviceId) throw new Error("This session has no device ID. Sign in again.");
      const encryption = await get().ensureDeviceKeypair(userId, token);
      const signing = await ensureDeviceSigningKey(userId);
      return { userId, deviceId, encryption, signingPrivateKey: signing.privateKey };
    },

    getConversationSecretKey: (conversationId) => get().secretKeyByConversationId[conversationId] ?? null,
    getConversationSecretKeyForVersion: (conversationId, keyVersion) => {
      const byVersion = get().secretKeyByConversationIdAndVersion[conversationId] ?? {};
      if (typeof keyVersion === "number" && byVersion[keyVersion]) {
        return byVersion[keyVersion];
      }
      if (typeof keyVersion === "number") {
        return null;
      }
      return get().secretKeyByConversationId[conversationId] ?? null;
    },
    getConversationKeyVersion: (conversationId) => get().keyVersionByConversationId[conversationId] ?? null,
    setConversationSecretKeyVersion: ({ conversationId, keyVersion, secretKey, sendable }) => {
      storeVersions(conversationId, { [keyVersion]: secretKey }, Math.max(keyVersion, get().keyVersionByConversationId[conversationId] ?? 0), {
        sendable: sendable ?? get().sendableByConversationId[conversationId],
      });
      set({ errorByConversationId: { ...get().errorByConversationId, [conversationId]: null } });
    },

    ensureConversationSecretKey: async ({ conversation, token, myUserId, forceRefresh }) => {
      const cached = get().secretKeyByConversationId[conversation.id];
      if (cached && !forceRefresh) return cached;

      const pending = conversationKeyLoadInFlight.get(conversation.id);
      if (pending) return pending;

      const loadPromise = (async () => {
        setLoading(conversation.id, true, null);
        try {
          const perDevice = await get().ensureKeyMode(myUserId);
          const key = perDevice
            ? await loadPerDeviceKeys(conversation, token, myUserId)
            : await loadLegacyKeys(conversation, token, myUserId);
          setLoading(conversation.id, false);
          return key;
        } catch (err: any) {
          setLoading(conversation.id, false, err?.message ?? "E2EE failed");
          return null;
        } finally {
          conversationKeyLoadInFlight.delete(conversation.id);
        }
      })();

      conversationKeyLoadInFlight.set(conversation.id, loadPromise);
      return loadPromise;
    },

    migrateLegacyKeys: (userId, token) => {
      const pending = legacyMoveInFlight.get(userId);
      if (pending) return pending;

      const run = (async () => {
        if (!(await get().ensureKeyMode(userId))) return false;
        const me = await get().thisDevice(userId, token);
        if (await legacyMoveDone(userId, me.deviceId)) return true;

        const own = await getOwnDevices(userId, token);
        const conversations = await api.getConversations(token);
        let complete = true;
        for (const conversation of conversations) {
          try {
            const rows = await api.getMyConversationKeys(conversation.id, token);
            const keys = await planLegacyMove({
              conversationId: conversation.id,
              rows,
              minReadableKeyVersion: conversation.members.find((m) => m.userId === userId)?.minReadableKeyVersion ?? 1,
              me,
              ownDevices: own.devices,
            });
            for (let i = 0; i < keys.length; i += 500) {
              await api.storeDeviceKeyBatch(keys.slice(i, i + 500), token);
            }
          } catch (err) {
            complete = false;
            devLog.warn(`Moving keys for conversation ${conversation.id} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // Until every conversation has moved, unsigned rows stay readable and the move reruns next sign-in.
        if (complete) await getPlatform().secureStore.set(legacyKeysMovedStorageKey(userId), me.deviceId);
        return complete;
      })().finally(() => legacyMoveInFlight.delete(userId));

      legacyMoveInFlight.set(userId, run);
      return run;
    },

    reset: () => {
      conversationKeyLoadInFlight.clear();
      identityCheckedAt.clear();
      set({ ...initialState });
    },
  };
});
