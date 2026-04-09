import sodium from "libsodium-wrappers";

function toB64(bytes: Uint8Array) {
  return sodium.to_base64(bytes);
}

function fromB64(text: string) {
  return sodium.from_base64(text);
}

function u32ToBytes(value: number) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function bytesToU32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function generateKeypair() {
  await sodium.ready;
  const keypair = sodium.crypto_box_keypair();
  return {
    publicKey: toB64(keypair.publicKey),
    privateKey: toB64(keypair.privateKey)
  };
}

export async function publicKeyFromPrivateKey(privateKeyBase64: string) {
  await sodium.ready;
  const sk = fromB64(privateKeyBase64);
  const pk = sodium.crypto_scalarmult_base(sk);
  return toB64(pk);
}

export async function generateSecretKey() {
  await sodium.ready;
  const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  return toB64(key);
}

export async function sha256Base64(data: Uint8Array) {
  const stableBytes = new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', stableBytes.buffer);
  return toB64(new Uint8Array(digest));
}

/**
 * Encrypt a symmetric key to a recipient's public key using a sealed box.
 * Recipient decrypts with their keypair.
 */
export async function sealToPublicKey(secretKeyBase64: string, recipientPublicKeyBase64: string) {
  await sodium.ready;
  const secretKey = fromB64(secretKeyBase64);
  const recipientPk = fromB64(recipientPublicKeyBase64);
  const sealed = sodium.crypto_box_seal(secretKey, recipientPk);
  return toB64(sealed);
}

/** Decrypt a sealed symmetric key using my keypair. */
export async function openSealedWithKeypair(
  sealedBase64: string,
  myPublicKeyBase64: string,
  myPrivateKeyBase64: string
) {
  await sodium.ready;
  const sealed = fromB64(sealedBase64);
  const pk = fromB64(myPublicKeyBase64);
  const sk = fromB64(myPrivateKeyBase64);
  const opened = sodium.crypto_box_seal_open(sealed, pk, sk);
  if (!opened) {
    throw new Error("Unable to decrypt conversation key with this device keypair");
  }
  return toB64(opened);
}

export async function encryptMessage(plainText: string, secretKeyBase64: string) {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const secretKey = fromB64(secretKeyBase64);
  const cipher = sodium.crypto_secretbox_easy(plainText, nonce, secretKey);
  return {
    cipherText: toB64(cipher),
    nonce: toB64(nonce)
  };
}

export async function decryptMessage(cipherTextBase64: string, nonceBase64: string, secretKeyBase64: string) {
  await sodium.ready;
  const cipher = fromB64(cipherTextBase64);
  const nonce = fromB64(nonceBase64);
  const secretKey = fromB64(secretKeyBase64);
  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, secretKey);
  if (!plain) {
    throw new Error("Unable to decrypt message with the current conversation key");
  }
  return sodium.to_string(plain);
}

export async function encryptBytes(data: Uint8Array, secretKeyBase64: string) {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const secretKey = fromB64(secretKeyBase64);
  const cipher = sodium.crypto_secretbox_easy(data, nonce, secretKey);
  return {
    cipher,
    nonce: toB64(nonce),
  };
}

export async function decryptBytes(cipher: Uint8Array, nonceBase64: string, secretKeyBase64: string) {
  await sodium.ready;
  const nonce = fromB64(nonceBase64);
  const secretKey = fromB64(secretKeyBase64);
  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, secretKey);
  if (!plain) {
    throw new Error('Unable to decrypt attachment bytes with the current key');
  }
  return plain;
}

export type ChunkedEncryptionResult = {
  encryptedBytes: Uint8Array;
  chunkSize: number;
  chunkCount: number;
};

const CHUNK_MAGIC = new Uint8Array([0x4f, 0x52, 0x42, 0x54, 0x31]); // ORBT1

export async function encryptChunkedBytes(
  data: Uint8Array,
  secretKeyBase64: string,
  chunkSize = 256 * 1024
): Promise<ChunkedEncryptionResult> {
  await sodium.ready;
  const chunks: Uint8Array[] = [];
  const totalChunks = Math.max(1, Math.ceil(data.length / chunkSize));

  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, data.length);
    const plainChunk = data.subarray(start, end);
    const { cipher, nonce } = await encryptBytes(plainChunk, secretKeyBase64);
    const nonceBytes = fromB64(nonce);
    chunks.push(u32ToBytes(cipher.length), nonceBytes, cipher);
  }

  const header = concatBytes([CHUNK_MAGIC, u32ToBytes(chunkSize), u32ToBytes(totalChunks)]);
  return {
    encryptedBytes: concatBytes([header, ...chunks]),
    chunkSize,
    chunkCount: totalChunks,
  };
}

export async function decryptChunkedBytes(payload: Uint8Array, secretKeyBase64: string) {
  await sodium.ready;
  const nonceSize = sodium.crypto_secretbox_NONCEBYTES;
  const minHeaderSize = CHUNK_MAGIC.length + 8;
  if (payload.length < minHeaderSize) {
    throw new Error('Attachment payload is malformed');
  }

  for (let i = 0; i < CHUNK_MAGIC.length; i += 1) {
    if (payload[i] !== CHUNK_MAGIC[i]) {
      throw new Error('Attachment payload has invalid format');
    }
  }

  const chunkCount = bytesToU32(payload, CHUNK_MAGIC.length + 4);
  let offset = minHeaderSize;
  const plainChunks: Uint8Array[] = [];

  for (let i = 0; i < chunkCount; i += 1) {
    if (offset + 4 + nonceSize > payload.length) {
      throw new Error('Attachment payload is truncated');
    }
    const cipherLen = bytesToU32(payload, offset);
    offset += 4;

    const nonceBytes = payload.subarray(offset, offset + nonceSize);
    offset += nonceSize;

    if (offset + cipherLen > payload.length) {
      throw new Error('Attachment payload is truncated');
    }
    const cipher = payload.subarray(offset, offset + cipherLen);
    offset += cipherLen;

    const plain = await decryptBytes(cipher, toB64(nonceBytes), secretKeyBase64);
    plainChunks.push(plain);
  }

  return concatBytes(plainChunks);
}
