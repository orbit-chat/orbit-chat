import fs from "node:fs";
import path from "node:path";

/**
 * Secrets file for the desktop secure store (mobile plan B4). Values are encrypted with the OS
 * keychain through Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret/kwallet
 * on Linux) before they touch disk; this module only handles the file. The cipher is injected so
 * the file logic is testable without Electron.
 *
 * The file may hold the only copy of the device's private key, so it is read strictly (anything
 * unexpected is an error, never silently dropped and later overwritten), written durably (fsync
 * before rename), and read from disk each time rather than from a cache that could hide a write
 * that never reached the disk.
 */
export type Cipher = {
  encrypt: (plain: string) => Buffer;
  decrypt: (encrypted: Buffer) => string;
};

/** Only the renderer's own namespaced keys, so the IPC can't be used as a general file store. */
const KEY_PATTERN = /^orbit:[A-Za-z0-9:_-]{1,200}$/;
export const MAX_KEY_LENGTH = 206;
export const MAX_VALUE_LENGTH = 64 * 1024;
const MAX_ENTRIES = 512;
const RENAME_RETRIES = 5;

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class SecureStoreFile {
  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher
  ) {}

  static validKey(key: unknown): key is string {
    return typeof key === "string" && KEY_PATTERN.test(key);
  }

  get(key: string): string | null {
    this.assertKey(key);
    const encrypted = this.entries()[key];
    if (encrypted === undefined) return null;
    return this.cipher.decrypt(Buffer.from(encrypted, "base64"));
  }

  set(key: string, value: string) {
    this.assertKey(key);
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) throw new Error("Invalid secure store value");
    const entries = this.entries();
    if (!(key in entries) && Object.keys(entries).length >= MAX_ENTRIES) throw new Error("Secure store is full");
    entries[key] = this.cipher.encrypt(value).toString("base64");
    this.write(entries);
  }

  remove(key: string) {
    this.assertKey(key);
    const entries = this.entries();
    if (!(key in entries)) return;
    delete entries[key];
    this.write(entries);
  }

  private assertKey(key: string) {
    if (!SecureStoreFile.validKey(key)) throw new Error("Invalid secure store key");
  }

  private entries(): Record<string, string> {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      // Unreadable is not "empty": treating it as empty would overwrite the only copy of a key.
      throw new Error(`Secure store file is unreadable: ${(error as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Secure store file is unreadable: ${(error as Error).message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Secure store file is malformed");
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      // Possibly written by a newer version; dropping it here would delete it on the next write.
      if (!SecureStoreFile.validKey(key) || typeof value !== "string") throw new Error("Secure store file is malformed");
      entries[key] = value;
    }
    return entries;
  }

  /** fsync a temp file, then rename it over the old one, so a crash can't leave a torn file. */
  private write(entries: Record<string, string>) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    try {
      const fd = fs.openSync(tmp, "w", 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(entries));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      this.renameWithRetry(tmp);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw error;
    }
  }

  /** Windows antivirus/indexers briefly lock a just-written file, failing the rename with EPERM. */
  private renameWithRetry(tmp: string) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.renameSync(tmp, this.filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const retryable = process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EBUSY");
        if (!retryable || attempt >= RENAME_RETRIES) throw error;
        sleepSync(20 * (attempt + 1));
      }
    }
  }
}
