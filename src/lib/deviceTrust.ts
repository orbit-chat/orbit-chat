import sodium from "libsodium-wrappers-sumo";

/**
 * Device trust primitives (docs/mobile-plan.md B5, B6, B9).
 *
 * Every signed object is transmitted as the exact canonical bytes that were signed, plus a
 * detached Ed25519 signature. Verifiers parse those bytes rather than re-encoding a JSON object,
 * so there is never a second serialization that could disagree with what was signed.
 *
 * Every signature covers a context string first (`orbit/<purpose>/v1`), so a signature made for
 * one purpose can never be replayed as another.
 */

export const DEVICE_LIST_CONTEXT = "orbit/device-list/v1";
export const KEY_ENVELOPE_CONTEXT = "orbit/key-envelope/v1";
export const MESSAGE_CONTEXT = "orbit/message/v1";
const FINGERPRINT_CONTEXT = "orbit/fingerprint/v1";

const KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;
const MAX_DEVICES = 64;
const MAX_FIELD_BYTES = 4096;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function toB64(bytes: Uint8Array) {
  return sodium.to_base64(bytes);
}

function fromB64(text: string, label: string) {
  try {
    return sodium.from_base64(text);
  } catch {
    throw new Error(`${label} is not valid base64`);
  }
}

function keyFromB64(text: string, label: string) {
  const bytes = fromB64(text, label);
  if (bytes.length !== KEY_BYTES) throw new Error(`${label} must be ${KEY_BYTES} bytes`);
  return bytes;
}

/** Length-prefixed field encoding: u32 big-endian length, then the bytes. */
class Writer {
  private parts: Uint8Array[] = [];

  bytes(value: Uint8Array) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, value.length, false);
    this.parts.push(len, value);
    return this;
  }

  string(value: string) {
    return this.bytes(encoder.encode(value));
  }

  u32(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error("Integer field is out of range");
    }
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, false);
    this.parts.push(out);
    return this;
  }

  finish() {
    const total = this.parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/** Strict reader for the Writer format: any truncation or trailing byte is an error. */
class Reader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  u32() {
    if (this.offset + 4 > this.data.length) throw new Error("Signed payload is truncated");
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getUint32(0, false);
    this.offset += 4;
    return value;
  }

  bytes() {
    const len = this.u32();
    if (len > MAX_FIELD_BYTES) throw new Error("Signed payload field is too large");
    if (this.offset + len > this.data.length) throw new Error("Signed payload is truncated");
    const value = this.data.slice(this.offset, this.offset + len);
    this.offset += len;
    return value;
  }

  string() {
    try {
      return decoder.decode(this.bytes());
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Signed payload")) throw error;
      throw new Error("Signed payload contains invalid text");
    }
  }

  end() {
    if (this.offset !== this.data.length) throw new Error("Signed payload has trailing bytes");
  }
}

// ─── Signing keys ────────────────────────────────────────

export type SigningKeypair = { publicKey: string; privateKey: string };

/** Ed25519 keypair, used both for a user's identity key and for each device's signing key. */
export async function generateSigningKeypair(): Promise<SigningKeypair> {
  await sodium.ready;
  const keypair = sodium.crypto_sign_keypair();
  return { publicKey: toB64(keypair.publicKey), privateKey: toB64(keypair.privateKey) };
}

export async function signingPublicKeyFromPrivateKey(privateKeyBase64: string) {
  await sodium.ready;
  const sk = fromB64(privateKeyBase64, "Signing private key");
  if (sk.length !== sodium.crypto_sign_SECRETKEYBYTES) throw new Error("Signing private key has the wrong length");
  // An Ed25519 secret key is seed ‖ public key. Re-derive from the seed rather than trusting the
  // stored half, so a corrupted key is caught here instead of producing unverifiable signatures.
  const derived = sodium.crypto_sign_seed_keypair(sk.subarray(0, 32)).publicKey;
  if (sodium.compare(derived, sk.subarray(32)) !== 0) throw new Error("Signing private key is corrupted");
  return toB64(derived);
}

function sign(payload: Uint8Array, privateKeyBase64: string) {
  const sk = fromB64(privateKeyBase64, "Signing private key");
  if (sk.length !== sodium.crypto_sign_SECRETKEYBYTES) throw new Error("Signing private key has the wrong length");
  return toB64(sodium.crypto_sign_detached(payload, sk));
}

function verify(payload: Uint8Array, signatureBase64: string, publicKeyBase64: string) {
  const signature = fromB64(signatureBase64, "Signature");
  if (signature.length !== SIGNATURE_BYTES) return false;
  const pk = keyFromB64(publicKeyBase64, "Signing public key");
  return sodium.crypto_sign_verify_detached(signature, payload, pk);
}

// ─── Signed device list (B6) ─────────────────────────────

export type DeviceListEntry = {
  deviceId: string;
  /** X25519 public key that conversation keys are sealed to. */
  encryptionPublicKey: string;
  /** Ed25519 public key that verifies this device's key envelopes and messages. */
  signingPublicKey: string;
  name: string;
  /** Unix milliseconds. */
  addedAt: number;
};

export type DeviceList = {
  userId: string;
  /** Only ever increases, so an old list (e.g. one still containing a revoked device) can't be replayed. */
  version: number;
  devices: DeviceListEntry[];
};

export type SignedDeviceList = {
  /** Base64 of the exact canonical bytes that were signed. */
  body: string;
  signature: string;
};

function encodeDeviceList(list: DeviceList) {
  if (list.devices.length === 0) throw new Error("A device list needs at least one device");
  if (list.devices.length > MAX_DEVICES) throw new Error("Too many devices in one list");
  for (const device of list.devices) {
    if (!device.deviceId) throw new Error("Device ID is required");
    if (encoder.encode(device.name).length > 128) throw new Error("Device name is too long");
  }
  const ids = new Set(list.devices.map((d) => d.deviceId));
  if (ids.size !== list.devices.length) throw new Error("Device list contains a duplicate device");

  // Sorted so the same set of devices always encodes to the same bytes.
  const devices = list.devices.slice().sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
  const writer = new Writer().string(DEVICE_LIST_CONTEXT).string(list.userId).u32(list.version).u32(devices.length);
  for (const device of devices) {
    writer
      .string(device.deviceId)
      .bytes(keyFromB64(device.encryptionPublicKey, "Device encryption key"))
      .bytes(keyFromB64(device.signingPublicKey, "Device signing key"))
      .string(device.name)
      // Split so millisecond timestamps fit the u32 fields.
      .u32(Math.floor(device.addedAt / 0x100000000))
      .u32(device.addedAt % 0x100000000);
  }
  return writer.finish();
}

function decodeDeviceList(bytes: Uint8Array): DeviceList {
  const reader = new Reader(bytes);
  if (reader.string() !== DEVICE_LIST_CONTEXT) throw new Error("Not a device list");
  const userId = reader.string();
  const version = reader.u32();
  const count = reader.u32();
  if (count === 0 || count > MAX_DEVICES) throw new Error("Device list has an invalid device count");

  const devices: DeviceListEntry[] = [];
  let previousId: string | null = null;
  for (let i = 0; i < count; i += 1) {
    const deviceId = reader.string();
    // Enforce the encoder's ordering, which also rules out duplicates.
    if (previousId !== null && deviceId <= previousId) throw new Error("Device list is not in canonical order");
    previousId = deviceId;
    const encryptionPublicKey = reader.bytes();
    const signingPublicKey = reader.bytes();
    if (encryptionPublicKey.length !== KEY_BYTES || signingPublicKey.length !== KEY_BYTES) {
      throw new Error("Device list contains a key of the wrong length");
    }
    const name = reader.string();
    const addedAt = reader.u32() * 0x100000000 + reader.u32();
    devices.push({
      deviceId,
      encryptionPublicKey: toB64(encryptionPublicKey),
      signingPublicKey: toB64(signingPublicKey),
      name,
      addedAt,
    });
  }
  reader.end();
  return { userId, version, devices };
}

/** Sign a device list with the user's identity private key. */
export async function signDeviceList(list: DeviceList, identityPrivateKey: string): Promise<SignedDeviceList> {
  await sodium.ready;
  const body = encodeDeviceList(list);
  return { body: toB64(body), signature: sign(body, identityPrivateKey) };
}

/**
 * Verify a signed device list against the identity key the caller has pinned for that user.
 * Throws unless the signature is valid, the list is for `expectedUserId`, and its version is at
 * least `minVersion` (the highest version already seen for this user).
 */
export async function verifyDeviceList(
  signed: SignedDeviceList,
  identityPublicKey: string,
  options: { expectedUserId: string; minVersion?: number }
): Promise<DeviceList> {
  await sodium.ready;
  const body = fromB64(signed.body, "Device list");
  if (!verify(body, signed.signature, identityPublicKey)) {
    throw new Error("Device list signature is invalid");
  }
  const list = decodeDeviceList(body);
  if (list.userId !== options.expectedUserId) throw new Error("Device list belongs to a different user");
  if (list.version < (options.minVersion ?? 0)) throw new Error("Device list is older than one already seen");
  return list;
}

// ─── Signed key envelopes (B5) ───────────────────────────

export type KeyEnvelope = {
  conversationId: string;
  keyVersion: number;
  recipientDeviceId: string;
  /** The sealed-box ciphertext of the conversation key, as stored on the server. */
  sealedKey: string;
};

function encodeKeyEnvelope(envelope: KeyEnvelope) {
  return new Writer()
    .string(KEY_ENVELOPE_CONTEXT)
    .string(envelope.conversationId)
    .u32(envelope.keyVersion)
    .string(envelope.recipientDeviceId)
    .bytes(fromB64(envelope.sealedKey, "Sealed key"))
    .finish();
}

/** Sign a conversation key envelope with the issuing device's signing private key. */
export async function signKeyEnvelope(envelope: KeyEnvelope, deviceSigningPrivateKey: string) {
  await sodium.ready;
  return sign(encodeKeyEnvelope(envelope), deviceSigningPrivateKey);
}

/** The caller must separately check that the issuer is a trusted device of a current member. */
export async function verifyKeyEnvelope(envelope: KeyEnvelope, signature: string, issuerSigningPublicKey: string) {
  await sodium.ready;
  return verify(encodeKeyEnvelope(envelope), signature, issuerSigningPublicKey);
}

// ─── Message signatures (B9) ─────────────────────────────

export type SignedMessageFields = {
  conversationId: string;
  keyVersion: number;
  messageId: string;
  nonce: string;
  cipherText: string;
};

function encodeMessage(message: SignedMessageFields) {
  return new Writer()
    .string(MESSAGE_CONTEXT)
    .string(message.conversationId)
    .u32(message.keyVersion)
    .string(message.messageId)
    .bytes(fromB64(message.nonce, "Message nonce"))
    .bytes(fromB64(message.cipherText, "Message ciphertext"))
    .finish();
}

/** Sign an encrypted message (encrypt-then-sign) with the sending device's signing private key. */
export async function signMessage(message: SignedMessageFields, deviceSigningPrivateKey: string) {
  await sodium.ready;
  return sign(encodeMessage(message), deviceSigningPrivateKey);
}

/** The caller must separately check that the signer is in the sender's verified device list. */
export async function verifyMessageSignature(
  message: SignedMessageFields,
  signature: string,
  senderSigningPublicKey: string
) {
  await sodium.ready;
  return verify(encodeMessage(message), signature, senderSigningPublicKey);
}

// ─── Fingerprints and safety numbers (B6) ────────────────

/** 30-digit fingerprint of one user's identity key, shown as six groups of five digits. */
export async function identityFingerprint(userId: string, identityPublicKey: string) {
  await sodium.ready;
  const input = new Writer()
    .string(FINGERPRINT_CONTEXT)
    .string(userId)
    .bytes(keyFromB64(identityPublicKey, "Identity key"))
    .finish();
  const digest = sodium.crypto_generichash(64, input);
  const groups: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    // 5 bytes (40 bits) per group, reduced to 5 digits.
    let value = 0;
    for (let j = 0; j < 5; j += 1) value = value * 256 + digest[i * 5 + j]!;
    groups.push(String(value % 100000).padStart(5, "0"));
  }
  return groups.join(" ");
}

/**
 * 60-digit safety number for a pair of users: both fingerprints, ordered by user ID so both
 * sides see the same number.
 */
export async function safetyNumber(
  a: { userId: string; identityPublicKey: string },
  b: { userId: string; identityPublicKey: string }
) {
  const [first, second] = a.userId < b.userId ? [a, b] : [b, a];
  const left = await identityFingerprint(first.userId, first.identityPublicKey);
  const right = await identityFingerprint(second.userId, second.identityPublicKey);
  return `${left} ${right}`;
}
