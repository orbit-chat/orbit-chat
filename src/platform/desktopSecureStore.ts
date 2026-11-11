import type { SecureStore } from "./index";

/** The preload's keychain-backed store (see electron/secureStore.ts). */
export type NativeSecureStore = {
  status: () => Promise<"ok" | "unavailable" | "locked">;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

/** Older desktop builds kept these secrets in plain localStorage under the same keys. */
export type LegacyStore = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export class SecureStoreLockedError extends Error {
  constructor() {
    super("Orbit's saved keys are encrypted with your system keychain, which isn't available right now. Unlock it and restart Orbit.");
    this.name = "SecureStoreLockedError";
  }
}

/**
 * Desktop secure store (mobile plan B4): secrets live in a file encrypted by the OS keychain via
 * Electron safeStorage, and existing plaintext localStorage copies move over on first read.
 *
 * Losing the device private key means losing chat history, so:
 * - a legacy copy is deleted only after the keychain copy reads back identical;
 * - when the keychain store exists but can't be opened ("locked"), every operation throws instead
 *   of reporting the secret missing, because a null would make the caller generate a new key;
 * - where there is no usable keychain at all ("unavailable", e.g. Linux without a keyring), it
 *   keeps using localStorage, as before;
 * - operations on one key run one at a time, so a migrating read can't resurrect a value that a
 *   concurrent write or remove just replaced.
 */
export function createDesktopSecureStore(native: NativeSecureStore, legacy: LegacyStore): SecureStore {
  let status: Promise<"ok" | "unavailable" | "locked"> | null = null;
  const mode = async () => {
    status ??= native.status().catch((error) => {
      status = null;
      throw error;
    });
    const value = await status;
    if (value === "locked") throw new SecureStoreLockedError();
    return value;
  };

  const queues = new Map<string, Promise<unknown>>();
  const serialized = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
    const settled = run.catch(() => undefined);
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
  };

  return {
    get: (key) =>
      serialized(key, async () => {
        if ((await mode()) === "unavailable") return legacy.getItem(key);

        const stored = await native.get(key);
        if (stored !== null) {
          // A crash between migrating and deleting can leave the plaintext copy behind.
          if (legacy.getItem(key) !== null) legacy.removeItem(key);
          return stored;
        }

        const old = legacy.getItem(key);
        if (old === null) return null;
        await native.set(key, old);
        if ((await native.get(key)) === old) legacy.removeItem(key);
        return old;
      }),

    set: (key, value) =>
      serialized(key, async () => {
        if ((await mode()) === "unavailable") {
          legacy.setItem(key, value);
          return;
        }
        await native.set(key, value);
        // Drop any plaintext copy, but only once the new value is really there.
        if (legacy.getItem(key) !== null && (await native.get(key)) === value) legacy.removeItem(key);
      }),

    remove: (key) =>
      serialized(key, async () => {
        if ((await mode()) === "ok") await native.remove(key);
        legacy.removeItem(key);
      })
  };
}
