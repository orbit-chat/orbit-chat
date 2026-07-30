import { describe, it, expect, beforeAll } from "vitest";
import sodium from "libsodium-wrappers";
import {
  generateKeypair,
  publicKeyFromPrivateKey,
  generateSecretKey,
  sha256Base64,
  sealToPublicKey,
  openSealedWithKeypair,
  encryptMessage,
  decryptMessage,
  encryptBytes,
  decryptBytes,
  encryptChunkedBytes,
  decryptChunkedBytes
} from "../crypto";

/**
 * These tests cover the E2EE envelope. The negative cases matter more than the
 * round-trips: a round-trip failure is loud and obvious in the app, whereas a
 * silently-accepted tampered ciphertext or a key that decrypts across versions
 * is an invisible break of the product's core guarantee.
 */

const CHUNK_MAGIC_LEN = 5; // "ORBT1"
const HEADER_LEN = CHUNK_MAGIC_LEN + 8; // magic + chunkSize + chunkCount

let NONCE_BYTES: number;

beforeAll(async () => {
  await sodium.ready;
  NONCE_BYTES = sodium.crypto_secretbox_NONCEBYTES;
});

function randomBytes(length: number) {
  return sodium.randombytes_buf(length);
}

describe("key generation", () => {
  it("derives the matching public key from a private key", async () => {
    const { publicKey, privateKey } = await generateKeypair();
    await expect(publicKeyFromPrivateKey(privateKey)).resolves.toBe(publicKey);
  });

  it("generates a distinct keypair each call", async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it("generates a secret key of the size secretbox expects", async () => {
    const key = await generateSecretKey();
    expect(sodium.from_base64(key)).toHaveLength(sodium.crypto_secretbox_KEYBYTES);
  });

  it("generates a distinct secret key each call", async () => {
    const keys = await Promise.all(Array.from({ length: 16 }, () => generateSecretKey()));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("sha256Base64", () => {
  it("is stable for identical input and differs for different input", async () => {
    const data = new TextEncoder().encode("orbit");
    expect(await sha256Base64(data)).toBe(await sha256Base64(data));
    expect(await sha256Base64(data)).not.toBe(
      await sha256Base64(new TextEncoder().encode("orbit "))
    );
  });

  it("hashes a subarray by its contents, not its backing buffer", async () => {
    // sha256Base64 copies into a fresh Uint8Array before hashing. Without that
    // copy, a subarray view would hash the whole parent buffer and two different
    // slices could collide.
    const parent = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const slice = parent.subarray(2, 4);
    const standalone = new Uint8Array([3, 4]);
    expect(await sha256Base64(slice)).toBe(await sha256Base64(standalone));
  });
});

describe("sealed box (conversation key distribution)", () => {
  it("round-trips a secret key to its intended recipient", async () => {
    const recipient = await generateKeypair();
    const secretKey = await generateSecretKey();

    const sealed = await sealToPublicKey(secretKey, recipient.publicKey);
    const opened = await openSealedWithKeypair(sealed, recipient.publicKey, recipient.privateKey);

    expect(opened).toBe(secretKey);
  });

  it("does NOT open with a different recipient's keypair", async () => {
    // The whole point of sealing per-member: Bob must not be able to open a key
    // that was sealed to Alice, even though the ciphertext transits the server.
    const alice = await generateKeypair();
    const bob = await generateKeypair();
    const secretKey = await generateSecretKey();

    const sealedToAlice = await sealToPublicKey(secretKey, alice.publicKey);

    // Asserts only that it throws, not the message: libsodium raises
    // "incorrect key pair for the given ciphertext" before crypto.ts:83 can
    // reach its own `if (!opened)` guard. See the note at the bottom of this file.
    await expect(
      openSealedWithKeypair(sealedToAlice, bob.publicKey, bob.privateKey)
    ).rejects.toThrow();
  });

  it("rejects a mismatched public/private key pair", async () => {
    const alice = await generateKeypair();
    const bob = await generateKeypair();
    const secretKey = await generateSecretKey();

    const sealed = await sealToPublicKey(secretKey, alice.publicKey);

    await expect(
      openSealedWithKeypair(sealed, alice.publicKey, bob.privateKey)
    ).rejects.toThrow();
  });

  it("rejects a tampered sealed box", async () => {
    const recipient = await generateKeypair();
    const secretKey = await generateSecretKey();

    const sealed = sodium.from_base64(await sealToPublicKey(secretKey, recipient.publicKey));
    sealed[sealed.length - 1] ^= 0x01;

    await expect(
      openSealedWithKeypair(
        sodium.to_base64(sealed),
        recipient.publicKey,
        recipient.privateKey
      )
    ).rejects.toThrow();
  });

  it("produces different ciphertext each time (sealed boxes use an ephemeral key)", async () => {
    const recipient = await generateKeypair();
    const secretKey = await generateSecretKey();

    const first = await sealToPublicKey(secretKey, recipient.publicKey);
    const second = await sealToPublicKey(secretKey, recipient.publicKey);

    expect(first).not.toBe(second);
  });
});

describe("message encryption", () => {
  it("round-trips plaintext", async () => {
    const key = await generateSecretKey();
    const { cipherText, nonce } = await encryptMessage("hello orbit", key);
    await expect(decryptMessage(cipherText, nonce, key)).resolves.toBe("hello orbit");
  });

  it.each([
    ["empty string", ""],
    ["unicode and emoji", "héllo 🌍 مرحبا 你好 🔐"],
    ["newlines and control chars", "line1\nline2\ttabbed\r\n"],
    ["long text", "a".repeat(100_000)]
  ])("round-trips %s", async (_label, plaintext) => {
    const key = await generateSecretKey();
    const { cipherText, nonce } = await encryptMessage(plaintext, key);
    await expect(decryptMessage(cipherText, nonce, key)).resolves.toBe(plaintext);
  });

  it("uses a fresh nonce for identical plaintext under the same key", async () => {
    // Nonce reuse under secretbox is catastrophic: it leaks the XOR of the two
    // plaintexts and breaks the Poly1305 authenticator.
    const key = await generateSecretKey();
    const results = await Promise.all(
      Array.from({ length: 32 }, () => encryptMessage("same message", key))
    );

    const nonces = results.map((r) => r.nonce);
    expect(new Set(nonces).size).toBe(nonces.length);
    // Same plaintext + same key must still yield different ciphertext.
    expect(new Set(results.map((r) => r.cipherText)).size).toBe(results.length);
  });

  it("produces a nonce of the expected length", async () => {
    const key = await generateSecretKey();
    const { nonce } = await encryptMessage("x", key);
    expect(sodium.from_base64(nonce)).toHaveLength(NONCE_BYTES);
  });

  it("throws rather than returning garbage when the key is wrong", async () => {
    const keyA = await generateSecretKey();
    const keyB = await generateSecretKey();
    const { cipherText, nonce } = await encryptMessage("secret", keyA);

    // The guarantee under test is "fails closed", not the wording. libsodium
    // throws "wrong secret key for the given ciphertext" before crypto.ts:106.
    await expect(decryptMessage(cipherText, nonce, keyB)).rejects.toThrow();
  });

  it("rejects tampered ciphertext (Poly1305 authentication)", async () => {
    const key = await generateSecretKey();
    const { cipherText, nonce } = await encryptMessage("transfer $10", key);

    const bytes = sodium.from_base64(cipherText);
    bytes[0] ^= 0x01;

    await expect(decryptMessage(sodium.to_base64(bytes), nonce, key)).rejects.toThrow();
  });

  it("rejects a tampered nonce", async () => {
    const key = await generateSecretKey();
    const { cipherText, nonce } = await encryptMessage("secret", key);

    const bytes = sodium.from_base64(nonce);
    bytes[0] ^= 0x01;

    await expect(decryptMessage(cipherText, sodium.to_base64(bytes), key)).rejects.toThrow();
  });

  it("rejects truncated ciphertext", async () => {
    const key = await generateSecretKey();
    const { cipherText, nonce } = await encryptMessage("secret message", key);

    const bytes = sodium.from_base64(cipherText);
    const truncated = bytes.subarray(0, bytes.length - 4);

    await expect(decryptMessage(sodium.to_base64(truncated), nonce, key)).rejects.toThrow();
  });

  it("does NOT decrypt across key versions", async () => {
    // Group rekey relies on this: after rotation, traffic encrypted under the
    // old key version must not be readable with the new key.
    const keyV1 = await generateSecretKey();
    const keyV2 = await generateSecretKey();

    const { cipherText, nonce } = await encryptMessage("pre-rotation message", keyV1);

    await expect(decryptMessage(cipherText, nonce, keyV2)).rejects.toThrow();
    await expect(decryptMessage(cipherText, nonce, keyV1)).resolves.toBe("pre-rotation message");
  });
});

describe("byte encryption (attachments)", () => {
  it("round-trips binary data", async () => {
    const key = await generateSecretKey();
    const data = randomBytes(4096);

    const { cipher, nonce } = await encryptBytes(data, key);
    await expect(decryptBytes(cipher, nonce, key)).resolves.toEqual(data);
  });

  it("round-trips empty input", async () => {
    const key = await generateSecretKey();
    const { cipher, nonce } = await encryptBytes(new Uint8Array(0), key);
    await expect(decryptBytes(cipher, nonce, key)).resolves.toEqual(new Uint8Array(0));
  });

  it("throws on the wrong key", async () => {
    const keyA = await generateSecretKey();
    const keyB = await generateSecretKey();
    const { cipher, nonce } = await encryptBytes(randomBytes(64), keyA);

    await expect(decryptBytes(cipher, nonce, keyB)).rejects.toThrow();
  });

  it("rejects tampered bytes", async () => {
    const key = await generateSecretKey();
    const { cipher, nonce } = await encryptBytes(randomBytes(64), key);
    cipher[10] ^= 0xff;

    await expect(decryptBytes(cipher, nonce, key)).rejects.toThrow();
  });
});

describe("chunked attachment encryption", () => {
  const chunkSize = 1024;

  it.each([
    ["smaller than one chunk", 100],
    ["exactly one chunk", 1024],
    ["one byte over a chunk", 1025],
    ["exactly two chunks", 2048],
    ["a non-multiple of chunk size", 5000],
    ["empty", 0]
  ])("round-trips a payload %s", async (_label, size) => {
    const key = await generateSecretKey();
    const data = randomBytes(size);

    const { encryptedBytes } = await encryptChunkedBytes(data, key, chunkSize);
    const decrypted = await decryptChunkedBytes(encryptedBytes, key);

    expect(decrypted).toEqual(data);
  });

  it("reports a chunk count consistent with the payload size", async () => {
    const key = await generateSecretKey();
    const result = await encryptChunkedBytes(randomBytes(5000), key, chunkSize);

    expect(result.chunkSize).toBe(chunkSize);
    expect(result.chunkCount).toBe(Math.ceil(5000 / chunkSize));
  });

  it("always emits at least one chunk, even for empty input", async () => {
    const key = await generateSecretKey();
    const result = await encryptChunkedBytes(new Uint8Array(0), key, chunkSize);
    expect(result.chunkCount).toBe(1);
  });

  it("round-trips at the default chunk size", async () => {
    const key = await generateSecretKey();
    const data = randomBytes(256 * 1024 + 17); // just over one default chunk

    const { encryptedBytes, chunkCount } = await encryptChunkedBytes(data, key);

    expect(chunkCount).toBe(2);
    await expect(decryptChunkedBytes(encryptedBytes, key)).resolves.toEqual(data);
  });

  it("throws on the wrong key", async () => {
    const keyA = await generateSecretKey();
    const keyB = await generateSecretKey();
    const { encryptedBytes } = await encryptChunkedBytes(randomBytes(2048), keyA, chunkSize);

    await expect(decryptChunkedBytes(encryptedBytes, keyB)).rejects.toThrow();
  });

  /**
   * decryptChunkedBytes parses length prefixes straight off the wire. The bytes
   * arrive from S3 via a signed URL, so a compromised or misbehaving storage
   * layer can supply arbitrary input here. Every malformed shape must fail
   * closed with a clear error rather than hanging, over-reading, or allocating
   * without bound.
   */
  describe("malformed payload handling", () => {
    async function validPayload(size = 2048) {
      const key = await generateSecretKey();
      const { encryptedBytes } = await encryptChunkedBytes(randomBytes(size), key, chunkSize);
      return { key, encryptedBytes };
    }

    it("rejects a payload shorter than the header", async () => {
      const key = await generateSecretKey();
      await expect(decryptChunkedBytes(new Uint8Array(4), key)).rejects.toThrow(/malformed/i);
    });

    it("rejects an empty payload", async () => {
      const key = await generateSecretKey();
      await expect(decryptChunkedBytes(new Uint8Array(0), key)).rejects.toThrow(/malformed/i);
    });

    it("rejects a bad magic prefix", async () => {
      const { key, encryptedBytes } = await validPayload();
      const corrupted = new Uint8Array(encryptedBytes);
      corrupted[0] = 0x00;

      await expect(decryptChunkedBytes(corrupted, key)).rejects.toThrow(/invalid format/i);
    });

    it("rejects a payload truncated mid-chunk", async () => {
      const { key, encryptedBytes } = await validPayload();
      const truncated = encryptedBytes.subarray(0, encryptedBytes.length - 32);

      await expect(decryptChunkedBytes(truncated, key)).rejects.toThrow(/truncated/i);
    });

    it("rejects a payload truncated immediately after the header", async () => {
      const { key, encryptedBytes } = await validPayload();
      const truncated = encryptedBytes.subarray(0, HEADER_LEN);

      await expect(decryptChunkedBytes(truncated, key)).rejects.toThrow(/truncated/i);
    });

    it("rejects an oversized chunk length prefix without over-reading", async () => {
      const { key, encryptedBytes } = await validPayload();
      const corrupted = new Uint8Array(encryptedBytes);
      // Overwrite the first chunk's u32 length prefix with a huge value.
      new DataView(corrupted.buffer).setUint32(HEADER_LEN, 0xffffffff, false);

      await expect(decryptChunkedBytes(corrupted, key)).rejects.toThrow(/truncated/i);
    });

    it("rejects an inflated chunk count instead of looping past the buffer", async () => {
      const { key, encryptedBytes } = await validPayload();
      const corrupted = new Uint8Array(encryptedBytes);
      // chunkCount lives at magic + 4 (immediately after chunkSize).
      new DataView(corrupted.buffer).setUint32(CHUNK_MAGIC_LEN + 4, 0xffffffff, false);

      await expect(decryptChunkedBytes(corrupted, key)).rejects.toThrow(/truncated/i);
    });

    it("rejects a chunk whose ciphertext has been tampered with", async () => {
      const { key, encryptedBytes } = await validPayload();
      const corrupted = new Uint8Array(encryptedBytes);
      // Skip header + length prefix + nonce to land inside the first ciphertext.
      corrupted[HEADER_LEN + 4 + NONCE_BYTES] ^= 0xff;

      await expect(decryptChunkedBytes(corrupted, key)).rejects.toThrow();
    });

    it("rejects a chunk whose nonce has been tampered with", async () => {
      const { key, encryptedBytes } = await validPayload();
      const corrupted = new Uint8Array(encryptedBytes);
      corrupted[HEADER_LEN + 4] ^= 0xff;

      await expect(decryptChunkedBytes(corrupted, key)).rejects.toThrow();
    });

    it("rejects a single-secretbox payload passed to the chunked parser", async () => {
      // Guards against the two attachment formats being confused for one another.
      const key = await generateSecretKey();
      const { cipher } = await encryptBytes(randomBytes(256), key);

      await expect(decryptChunkedBytes(cipher, key)).rejects.toThrow();
    });
  });
});

/**
 * NOTE — dead error branches in src/lib/crypto.ts
 *
 * crypto.ts:83, :106 and :128 each check `if (!opened)` / `if (!plain)` and throw
 * a friendly message. Those branches are unreachable: libsodium-wrappers throws
 * on authentication failure rather than returning null, so callers always see
 * libsodium's raw wording ("wrong secret key for the given ciphertext") instead.
 *
 * Not a security issue — decryption still fails closed, which is what these tests
 * pin down. It is a UX gap: the intended user-facing messages never surface.
 * Fixing it means wrapping the sodium calls in try/catch and rethrowing; left
 * alone here because that is an app change, not a test change.
 */
