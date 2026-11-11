import { describe, expect, it, vi } from "vitest";
import { createDesktopSecureStore, SecureStoreLockedError, type LegacyStore, type NativeSecureStore } from "../desktopSecureStore";

function legacyStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store: LegacyStore & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  };
  return store;
}

function nativeStore(status: "ok" | "unavailable" | "locked" = "ok", initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store: NativeSecureStore & { data: Map<string, string> } = {
    data,
    status: vi.fn(async () => status),
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void data.set(key, value)),
    remove: vi.fn(async (key: string) => void data.delete(key))
  };
  return store;
}

const KEY = "orbit:privateKey:user-1";

describe("desktop secure store migration", () => {
  it("moves a legacy localStorage secret into the keychain store and deletes the plaintext copy", async () => {
    const legacy = legacyStore({ [KEY]: "secret" });
    const native = nativeStore();
    const store = createDesktopSecureStore(native, legacy);

    await expect(store.get(KEY)).resolves.toBe("secret");
    expect(native.data.get(KEY)).toBe("secret");
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it("keeps the legacy copy when the keychain copy doesn't read back identical", async () => {
    const legacy = legacyStore({ [KEY]: "secret" });
    const native = nativeStore();
    native.get = vi.fn(async () => null); // writes appear to succeed but never persist
    const store = createDesktopSecureStore(native, legacy);

    await expect(store.get(KEY)).resolves.toBe("secret");
    expect(legacy.data.get(KEY)).toBe("secret");
  });

  it("keeps the legacy copy when writing to the keychain fails", async () => {
    const legacy = legacyStore({ [KEY]: "secret" });
    const native = nativeStore();
    native.set = vi.fn(async () => {
      throw new Error("disk full");
    });
    const store = createDesktopSecureStore(native, legacy);

    await expect(store.get(KEY)).rejects.toThrow("disk full");
    expect(legacy.data.get(KEY)).toBe("secret");
  });

  it("prefers the keychain copy over a stale legacy one", async () => {
    const legacy = legacyStore({ [KEY]: "old" });
    const native = nativeStore("ok", { [KEY]: "new" });
    const store = createDesktopSecureStore(native, legacy);

    await expect(store.get(KEY)).resolves.toBe("new");
  });

  it("returns null only when neither store has the secret", async () => {
    const store = createDesktopSecureStore(nativeStore(), legacyStore());
    await expect(store.get(KEY)).resolves.toBeNull();
  });

  it("writes new secrets to the keychain only, and clears an old plaintext copy", async () => {
    const legacy = legacyStore({ [KEY]: "old" });
    const native = nativeStore();
    const store = createDesktopSecureStore(native, legacy);

    await store.set(KEY, "new");
    expect(native.data.get(KEY)).toBe("new");
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it("removes a secret from both stores", async () => {
    const legacy = legacyStore({ [KEY]: "a" });
    const native = nativeStore("ok", { [KEY]: "a" });
    const store = createDesktopSecureStore(native, legacy);

    await store.remove(KEY);
    expect(native.data.has(KEY)).toBe(false);
    expect(legacy.data.has(KEY)).toBe(false);
  });
});

describe("desktop secure store without a usable keychain", () => {
  it("throws instead of reporting secrets missing when the keychain store is locked", async () => {
    // A null here would make sign-in generate a new device key and lose history.
    const store = createDesktopSecureStore(nativeStore("locked"), legacyStore());
    await expect(store.get(KEY)).rejects.toBeInstanceOf(SecureStoreLockedError);
    await expect(store.set(KEY, "x")).rejects.toBeInstanceOf(SecureStoreLockedError);
  });

  it("keeps using localStorage where no keychain exists", async () => {
    const legacy = legacyStore({ [KEY]: "secret" });
    const native = nativeStore("unavailable");
    const store = createDesktopSecureStore(native, legacy);

    await expect(store.get(KEY)).resolves.toBe("secret");
    await store.set("orbit:installId", "id");
    expect(legacy.data.get("orbit:installId")).toBe("id");
    expect(native.set).not.toHaveBeenCalled();
  });

  it("asks for the status once, and again after a failed check", async () => {
    const native = nativeStore();
    let calls = 0;
    native.status = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("ipc not ready");
      return "ok" as const;
    });
    const store = createDesktopSecureStore(native, legacyStore());

    await expect(store.get(KEY)).rejects.toThrow("ipc not ready");
    await store.get(KEY);
    await store.get(KEY);
    expect(native.status).toHaveBeenCalledTimes(2);
  });
});

describe("desktop secure store edge cases", () => {
  it("deletes a plaintext copy left behind by an interrupted migration", async () => {
    const legacy = legacyStore({ [KEY]: "secret" });
    const store = createDesktopSecureStore(nativeStore("ok", { [KEY]: "secret" }), legacy);
    await expect(store.get(KEY)).resolves.toBe("secret");
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it("doesn't wipe the legacy copy when asked to remove while locked", async () => {
    const legacy = legacyStore({ [KEY]: "secret" });
    const store = createDesktopSecureStore(nativeStore("locked"), legacy);
    await expect(store.remove(KEY)).rejects.toBeInstanceOf(SecureStoreLockedError);
    expect(legacy.data.get(KEY)).toBe("secret");
  });

  it("a migrating read can't overwrite a concurrent write", async () => {
    const legacy = legacyStore({ [KEY]: "old" });
    const native = nativeStore();
    const store = createDesktopSecureStore(native, legacy);
    await Promise.all([store.get(KEY), store.set(KEY, "new")]);
    expect(native.data.get(KEY)).toBe("new");
    await expect(store.get(KEY)).resolves.toBe("new");
  });

  it("a migrating read can't resurrect a concurrently removed key", async () => {
    const legacy = legacyStore({ [KEY]: "old" });
    const native = nativeStore();
    const store = createDesktopSecureStore(native, legacy);
    await Promise.all([store.get(KEY), store.remove(KEY)]);
    expect(native.data.has(KEY)).toBe(false);
    expect(legacy.data.has(KEY)).toBe(false);
  });

  it("keeps serving a key after an earlier operation on it failed", async () => {
    const native = nativeStore();
    let fail = true;
    const realSet = native.set;
    native.set = vi.fn(async (key: string, value: string) => {
      if (fail) {
        fail = false;
        throw new Error("transient");
      }
      return realSet(key, value);
    });
    const store = createDesktopSecureStore(native, legacyStore());
    await expect(store.set(KEY, "a")).rejects.toThrow("transient");
    await store.set(KEY, "b");
    await expect(store.get(KEY)).resolves.toBe("b");
  });
});
