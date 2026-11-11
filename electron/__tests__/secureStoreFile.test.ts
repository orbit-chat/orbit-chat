import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SecureStoreFile, type Cipher } from "../secureStoreFile";

// Reversible stand-in for safeStorage; the point is that plaintext never reaches the file.
const cipher: Cipher = {
  encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString("hex")}`),
  decrypt: (encrypted) => Buffer.from(encrypted.toString().slice(4), "hex").toString()
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-secure-"));
  file = path.join(dir, "secure-store.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SecureStoreFile", () => {
  it("round-trips values and never writes them in plaintext", () => {
    new SecureStoreFile(file, cipher).set("orbit:privateKey:u1", "very-secret");
    expect(fs.readFileSync(file, "utf8")).not.toContain("very-secret");
    expect(new SecureStoreFile(file, cipher).get("orbit:privateKey:u1")).toBe("very-secret");
  });

  it("returns null for a missing key and a missing file", () => {
    expect(new SecureStoreFile(file, cipher).get("orbit:nothing")).toBeNull();
  });

  it("removes keys", () => {
    const store = new SecureStoreFile(file, cipher);
    store.set("orbit:a", "1");
    store.set("orbit:b", "2");
    store.remove("orbit:a");
    const reopened = new SecureStoreFile(file, cipher);
    expect(reopened.get("orbit:a")).toBeNull();
    expect(reopened.get("orbit:b")).toBe("2");
  });

  it("rejects keys outside the orbit namespace", () => {
    const store = new SecureStoreFile(file, cipher);
    for (const key of ["", "privateKey", "orbit:", "orbit:../../etc", "orbit:a b", `orbit:${"x".repeat(201)}`]) {
      expect(() => store.set(key, "v")).toThrow(/key/);
    }
  });

  it("refuses to replace a corrupt file, which may hold the only copy of a key", () => {
    fs.writeFileSync(file, "{not json");
    const store = new SecureStoreFile(file, cipher);
    expect(() => store.set("orbit:a", "1")).toThrow(/unreadable/);
    expect(fs.readFileSync(file, "utf8")).toBe("{not json");
  });

  it("leaves no temp file behind", () => {
    new SecureStoreFile(file, cipher).set("orbit:a", "1");
    expect(fs.readdirSync(dir)).toEqual(["secure-store.json"]);
  });
});

describe("SecureStoreFile strict reading", () => {
  it.each([
    ["an array", "[]"],
    ["a null value", '{"orbit:k":null}'],
    ["an object value", '{"orbit:k":{"v":2}}'],
    ["an unknown top-level key", '{"version":2,"orbit:k":"x"}']
  ])("refuses %s instead of dropping entries it doesn't understand", (_label, content) => {
    fs.writeFileSync(file, content);
    const store = new SecureStoreFile(file, cipher);
    expect(() => store.get("orbit:k")).toThrow(/malformed/);
    expect(() => store.set("orbit:other", "v")).toThrow(/malformed/);
    expect(fs.readFileSync(file, "utf8")).toBe(content);
  });

  it("surfaces a decrypt failure instead of reporting the key missing", () => {
    new SecureStoreFile(file, cipher).set("orbit:k", "v");
    const broken = new SecureStoreFile(file, { ...cipher, decrypt: () => { throw new Error("keychain denied"); } });
    expect(() => broken.get("orbit:k")).toThrow("keychain denied");
  });

  it("reads what another writer stored, not a stale cache", () => {
    const a = new SecureStoreFile(file, cipher);
    const b = new SecureStoreFile(file, cipher);
    a.set("orbit:k", "1");
    b.set("orbit:other", "2");
    a.set("orbit:k", "3");
    expect(new SecureStoreFile(file, cipher).get("orbit:other")).toBe("2");
  });

  it("caps value size and entry count, but still updates an existing key when full", () => {
    const store = new SecureStoreFile(file, cipher);
    expect(() => store.set("orbit:big", "x".repeat(64 * 1024 + 1))).toThrow(/value/);
    const entries: Record<string, string> = {};
    for (let i = 0; i < 512; i += 1) entries[`orbit:k${i}`] = cipher.encrypt("v").toString("base64");
    fs.writeFileSync(file, JSON.stringify(entries));
    expect(() => store.set("orbit:new", "v")).toThrow(/full/);
    store.set("orbit:k0", "updated");
    expect(store.get("orbit:k0")).toBe("updated");
  });
});
