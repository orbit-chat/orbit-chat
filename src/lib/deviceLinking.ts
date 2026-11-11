import sodium from "libsodium-wrappers-sumo";
import { CPaceParty, lvCat } from "./cpace";
import {
  signingPublicKeyFromPrivateKey,
  verifyDeviceList,
  type DeviceList,
  type DeviceListEntry,
  type SignedDeviceList,
} from "./deviceTrust";

/**
 * Device linking (mobile plan B7): how an already trusted device (E) hands a new device (N) the
 * user's identity key through a channel the server can't tamper with.
 *
 * The server only relays opaque messages. Everything is authenticated by a key the server never
 * sees: 32 random bytes shown in a QR code, or a short typed code stretched with CPace (an active
 * attacker gets one guess per session). On top of that channel:
 *
 * 1. N → E `hello`: N's device ID and public keys, with a signature proving it holds the signing key.
 * 2. Both screens show a 6-digit code derived from the hello, and the user confirms on E.
 * 3. E publishes the next device list with N added (signed by the identity key), then sends
 *    E → N `welcome`: the identity private key and that list, signed by E's device key.
 *
 * Conversation keys don't travel here: E re-seals them for N through `POST /keys/device-batch`.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
/**
 * UTF-8 bytes in this realm's Uint8Array. TextEncoder can hand back an array from another realm
 * (jsdom), which libsodium's type checks reject.
 */
const utf8 = (text: string) => new Uint8Array(encoder.encode(text));

export const LINK_QR_PREFIX = "orbit-link:";
/** Libsodium must be ready before the synchronous helpers here run. */
export const linkingReady = sodium.ready;
const QR_KEY_CONTEXT = "orbit/link/qr/v1";
const CODE_KEY_CONTEXT = "orbit/link/code/v1";
const MESSAGE_CONTEXT = "orbit/link/msg/v1";
const CONFIRM_CONTEXT = "orbit/link/confirm/v1";
const HELLO_CONTEXT = "orbit/link/hello/v1";
const WELCOME_CONTEXT = "orbit/link/welcome/v1";
const FINGERPRINT_CONTEXT = "orbit/link/fingerprint/v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_BYTES = 128;

export type LinkRole = "existing" | "new";
export type LinkDirection = "n2e" | "e2n";

/** Anything wrong with a linking message. The session must be ended, never retried with the same secret. */
export class LinkProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkProtocolError";
  }
}

const b64 = (bytes: Uint8Array) => sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
function fromB64(text: string, label: string) {
  try {
    return sodium.from_base64(text, sodium.base64_variants.URLSAFE_NO_PADDING);
  } catch {
    throw new LinkProtocolError(`${label} is not valid base64`);
  }
}

function uuidBytes(id: string) {
  if (!UUID_PATTERN.test(id)) throw new LinkProtocolError("Invalid session ID");
  return sodium.from_hex(id.replace(/-/g, ""));
}

// ─── Typed codes ─────────────────────────────────────────

/** Crockford base32: no I, L, O or U, so a code survives being read aloud and retyped. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LINK_CODE_LENGTH = 8;

/** 8 characters, 40 random bits. */
export function generateLinkCode() {
  const bytes = sodium.randombytes_buf(5);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) {
    code = CROCKFORD[Number(value & 31n)] + code;
    value >>= 5n;
  }
  return code;
}

/** Canonical form of a typed code (case, separators and look-alike letters forgiven), or null if it can't be one. */
export function normalizeLinkCode(input: string) {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (cleaned.length !== LINK_CODE_LENGTH) return null;
  for (const char of cleaned) if (!CROCKFORD.includes(char)) return null;
  return cleaned;
}

export function formatLinkCode(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// ─── QR payload ──────────────────────────────────────────

export type LinkQrPayload = {
  v: 1;
  sessionId: string;
  userId: string;
  /** 32 random bytes, base64url: the channel key's only input besides public IDs. */
  secret: string;
  creatorRole: LinkRole;
  creatorDeviceId: string;
  /** When the trusted device shows the code: its signing key's fingerprint, checked against the welcome. */
  fingerprint?: string;
};

export function newLinkSecret() {
  return b64(sodium.randombytes_buf(32));
}

export function encodeLinkQr(payload: LinkQrPayload) {
  return LINK_QR_PREFIX + b64(utf8(JSON.stringify(payload)));
}

export function decodeLinkQr(text: string): LinkQrPayload {
  if (!text.startsWith(LINK_QR_PREFIX)) throw new LinkProtocolError("That isn't an Orbit linking code");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(fromB64(text.slice(LINK_QR_PREFIX.length), "Linking code")));
  } catch (error) {
    if (error instanceof LinkProtocolError) throw error;
    throw new LinkProtocolError("That linking code is damaged");
  }
  const p = parsed as Partial<LinkQrPayload>;
  const ok =
    p &&
    p.v === 1 &&
    typeof p.sessionId === "string" &&
    UUID_PATTERN.test(p.sessionId) &&
    typeof p.userId === "string" &&
    UUID_PATTERN.test(p.userId) &&
    typeof p.creatorDeviceId === "string" &&
    UUID_PATTERN.test(p.creatorDeviceId) &&
    (p.creatorRole === "existing" || p.creatorRole === "new") &&
    typeof p.secret === "string" &&
    (p.fingerprint === undefined || typeof p.fingerprint === "string");
  if (!ok) throw new LinkProtocolError("That linking code is damaged");
  if (fromB64(p.secret!, "Linking secret").length !== 32) throw new LinkProtocolError("That linking code is damaged");
  return p as LinkQrPayload;
}

/** Short fingerprint of a device signing key, carried in the QR when the trusted device shows it. */
export function signingKeyFingerprint(signingPublicKey: string) {
  return b64(sodium.crypto_generichash(16, lvCat(utf8(FINGERPRINT_CONTEXT), fromB64(signingPublicKey, "Signing key"))));
}

// ─── The channel ─────────────────────────────────────────

/**
 * Authenticated encryption between the two devices for one session. Every message is bound to
 * the session, its direction and its type, so nothing can be replayed into another session,
 * reflected back to its sender, or passed off as a different step.
 */
export class LinkChannel {
  private constructor(
    private readonly key: Uint8Array,
    readonly userId: string,
    readonly sessionId: string
  ) {}

  /** QR mode: the key comes from the secret in the code. */
  static fromSecret(secret: string, userId: string, sessionId: string) {
    const bytes = fromB64(secret, "Linking secret");
    if (bytes.length !== 32) throw new LinkProtocolError("Linking secret has the wrong length");
    return new LinkChannel(LinkChannel.derive(bytes, QR_KEY_CONTEXT, userId, sessionId), userId, sessionId);
  }

  /** Typed mode: the key comes from CPace's output. */
  static fromIsk(isk: Uint8Array, userId: string, sessionId: string) {
    return new LinkChannel(LinkChannel.derive(isk, CODE_KEY_CONTEXT, userId, sessionId), userId, sessionId);
  }

  private static derive(input: Uint8Array, context: string, userId: string, sessionId: string) {
    return sodium.crypto_generichash(32, lvCat(utf8(context), utf8(userId), uuidBytes(sessionId)), input);
  }

  private ad(direction: LinkDirection, type: string) {
    return lvCat(utf8(MESSAGE_CONTEXT), uuidBytes(this.sessionId), utf8(direction), utf8(type));
  }

  seal(direction: LinkDirection, type: string, plaintext: Uint8Array) {
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, this.ad(direction, type), null, nonce, this.key);
    return encodeWire(type, nonce, ciphertext);
  }

  open(direction: LinkDirection, type: string, wire: string) {
    const fields = decodeWire(wire, type, 2);
    try {
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, fields[1]!, this.ad(direction, type), fields[0]!, this.key);
    } catch {
      throw new LinkProtocolError("A linking message failed authentication");
    }
  }

  /** The 6 digits both screens show for the user to compare, derived from the exact hello sent. */
  confirmationCode(helloWire: string) {
    const digest = sodium.crypto_generichash(32, lvCat(utf8(CONFIRM_CONTEXT), utf8(helloWire)), this.key);
    const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
    return String(value % 1_000_000).padStart(6, "0");
  }
}

/** Wire format: base64url of lv_cat(type, fields...), so a message names its own step. */
function encodeWire(type: string, ...fields: Uint8Array[]) {
  return b64(lvCat(utf8(type), ...fields));
}

function decodeWire(wire: string, expectedType: string, fieldCount: number) {
  const bytes = fromB64(wire, "Linking message");
  const fields: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let length = 0;
    let shift = 1;
    for (;;) {
      if (offset >= bytes.length) throw new LinkProtocolError("Linking message is truncated");
      const byte = bytes[offset++]!;
      length += (byte & 0x7f) * shift;
      if (byte < 0x80) break;
      shift *= 128;
      if (shift > 2 ** 28) throw new LinkProtocolError("Linking message is malformed");
    }
    if (offset + length > bytes.length) throw new LinkProtocolError("Linking message is truncated");
    fields.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  if (fields.length !== fieldCount + 1) throw new LinkProtocolError("Linking message is malformed");
  let type: string;
  try {
    type = decoder.decode(fields[0]);
  } catch {
    throw new LinkProtocolError("Linking message is malformed");
  }
  if (type !== expectedType) throw new LinkProtocolError(`Expected a ${expectedType} message`);
  return fields.slice(1);
}

/** The step a wire message claims to be (before it's authenticated). */
export function wireType(wire: string) {
  try {
    const bytes = fromB64(wire, "Linking message");
    const length = bytes[0] ?? 0;
    if (length >= 0x80) return null;
    return decoder.decode(bytes.slice(1, 1 + length));
  } catch {
    return null;
  }
}

// ─── Typed mode: CPace ───────────────────────────────────

/**
 * One side of the CPace exchange for a typed code. The creator of the session is CPace's
 * initiator; each side's device ID is its AD, and the account and session form the channel
 * identifier, so the key is bound to exactly this pairing.
 */
export function startCodeExchange(params: {
  code: string;
  userId: string;
  sessionId: string;
  creatorDeviceId: string;
  joinerDeviceId: string;
  side: "creator" | "joiner";
}) {
  const code = normalizeLinkCode(params.code);
  if (!code) throw new LinkProtocolError("That code isn't valid");
  const creatorAd = utf8(params.creatorDeviceId);
  const joinerAd = utf8(params.joinerDeviceId);
  const party = new CPaceParty(params.side === "creator" ? "initiator" : "responder", {
    prs: utf8(code),
    ci: lvCat(utf8(CODE_KEY_CONTEXT), utf8(params.userId), uuidBytes(params.sessionId)),
    sid: uuidBytes(params.sessionId),
    ad: params.side === "creator" ? creatorAd : joinerAd,
  });
  return {
    wire: encodeWire("cpace", party.message),
    /** Finish with the other side's message. Throws `LinkProtocolError` on an invalid one. */
    finish(peerWire: string) {
      const [peerY] = decodeWire(peerWire, "cpace", 1);
      try {
        const isk = party.finish(peerY!, params.side === "creator" ? joinerAd : creatorAd);
        return LinkChannel.fromIsk(isk, params.userId, params.sessionId);
      } catch {
        throw new LinkProtocolError("The linking key exchange failed");
      }
    },
  };
}

// ─── Hello (N → E) ───────────────────────────────────────

export type LinkHello = {
  deviceId: string;
  encryptionPublicKey: string;
  signingPublicKey: string;
  name: string;
};

function helloProofPayload(channel: LinkChannel, hello: LinkHello) {
  return lvCat(
    utf8(HELLO_CONTEXT),
    utf8(channel.userId),
    uuidBytes(channel.sessionId),
    utf8(hello.deviceId),
    fromB64(hello.encryptionPublicKey, "Encryption key"),
    fromB64(hello.signingPublicKey, "Signing key"),
    utf8(hello.name)
  );
}

export async function buildHello(channel: LinkChannel, hello: LinkHello, signingPrivateKey: string) {
  await sodium.ready;
  const proof = sodium.crypto_sign_detached(helloProofPayload(channel, hello), fromB64(signingPrivateKey, "Signing key"));
  const body = utf8(JSON.stringify({ ...hello, proof: b64(proof) }));
  return channel.seal("n2e", "hello", body);
}

/** E reads N's hello: it must come through the channel, from the device the session names, holding its signing key. */
export async function readHello(channel: LinkChannel, wire: string, expectedDeviceId: string): Promise<LinkHello> {
  await sodium.ready;
  let parsed: Partial<LinkHello & { proof: string }>;
  try {
    parsed = JSON.parse(decoder.decode(channel.open("n2e", "hello", wire)));
  } catch (error) {
    if (error instanceof LinkProtocolError) throw error;
    throw new LinkProtocolError("The new device's message is malformed");
  }
  const { deviceId, encryptionPublicKey, signingPublicKey, name, proof } = parsed;
  if (
    typeof deviceId !== "string" ||
    typeof encryptionPublicKey !== "string" ||
    typeof signingPublicKey !== "string" ||
    typeof name !== "string" ||
    typeof proof !== "string"
  ) {
    throw new LinkProtocolError("The new device's message is malformed");
  }
  if (deviceId !== expectedDeviceId) throw new LinkProtocolError("The message came from a different device than the one linking");
  if (fromB64(encryptionPublicKey, "Encryption key").length !== 32 || fromB64(signingPublicKey, "Signing key").length !== 32) {
    throw new LinkProtocolError("The new device's keys are malformed");
  }
  if (utf8(name).length > MAX_NAME_BYTES) throw new LinkProtocolError("The new device's name is too long");
  const hello = { deviceId, encryptionPublicKey, signingPublicKey, name };
  const valid = sodium.crypto_sign_verify_detached(fromB64(proof, "Proof"), helloProofPayload(channel, hello), fromB64(signingPublicKey, "Signing key"));
  if (!valid) throw new LinkProtocolError("The new device couldn't prove it holds its signing key");
  return hello;
}

// ─── Welcome (E → N) ─────────────────────────────────────

function welcomeSignaturePayload(
  channel: LinkChannel,
  params: { newDeviceId: string; deviceList: SignedDeviceList; identityPublicKey: string }
) {
  return lvCat(
    utf8(WELCOME_CONTEXT),
    utf8(channel.userId),
    uuidBytes(channel.sessionId),
    utf8(params.newDeviceId),
    fromB64(params.deviceList.body, "Device list"),
    fromB64(params.deviceList.signature, "Device list signature"),
    fromB64(params.identityPublicKey, "Identity key")
  );
}

export async function buildWelcome(
  channel: LinkChannel,
  params: { identityPrivateKey: string; deviceList: SignedDeviceList; linkerDeviceId: string; newDeviceId: string },
  linkerSigningPrivateKey: string
) {
  await sodium.ready;
  const identityPublicKey = await signingPublicKeyFromPrivateKey(params.identityPrivateKey);
  const signature = sodium.crypto_sign_detached(
    welcomeSignaturePayload(channel, { newDeviceId: params.newDeviceId, deviceList: params.deviceList, identityPublicKey }),
    fromB64(linkerSigningPrivateKey, "Signing key")
  );
  const body = {
    identityPrivateKey: params.identityPrivateKey,
    deviceList: { body: params.deviceList.body, signature: params.deviceList.signature },
    linkerDeviceId: params.linkerDeviceId,
    signature: b64(signature),
  };
  return channel.seal("e2n", "welcome", utf8(JSON.stringify(body)));
}

/**
 * N reads E's welcome. Accepted only if: it came through the channel; the identity key is the
 * account's (as the server publishes it); the list it carries is signed by that identity, is no
 * older than the newest N has seen, and lists N with exactly its keys; the linking device is on
 * that list and signed the welcome; and, when the QR named it, its key matches the fingerprint.
 */
export async function readWelcome(
  channel: LinkChannel,
  wire: string,
  expected: { me: LinkHello; accountIdentityKey: string; minListVersion: number; linkerFingerprint?: string }
): Promise<{ identityPrivateKey: string; identityPublicKey: string; list: DeviceList }> {
  await sodium.ready;
  let parsed: { identityPrivateKey?: unknown; deviceList?: { body?: unknown; signature?: unknown }; linkerDeviceId?: unknown; signature?: unknown };
  try {
    parsed = JSON.parse(decoder.decode(channel.open("e2n", "welcome", wire)));
  } catch (error) {
    if (error instanceof LinkProtocolError) throw error;
    throw new LinkProtocolError("The linking device's message is malformed");
  }
  const { identityPrivateKey, deviceList, linkerDeviceId, signature } = parsed;
  if (
    typeof identityPrivateKey !== "string" ||
    typeof linkerDeviceId !== "string" ||
    typeof signature !== "string" ||
    typeof deviceList?.body !== "string" ||
    typeof deviceList?.signature !== "string"
  ) {
    throw new LinkProtocolError("The linking device's message is malformed");
  }
  const signedList = { body: deviceList.body, signature: deviceList.signature };

  let identityPublicKey: string;
  try {
    identityPublicKey = await signingPublicKeyFromPrivateKey(identityPrivateKey);
  } catch {
    throw new LinkProtocolError("The identity key is malformed");
  }
  if (identityPublicKey !== expected.accountIdentityKey) throw new LinkProtocolError("That identity key isn't your account's");

  let list: DeviceList;
  try {
    list = await verifyDeviceList(signedList, identityPublicKey, { expectedUserId: channel.userId, minVersion: expected.minListVersion });
  } catch {
    throw new LinkProtocolError("The device list doesn't verify");
  }
  const mine = list.devices.find((d) => d.deviceId === expected.me.deviceId);
  if (!mine || mine.encryptionPublicKey !== expected.me.encryptionPublicKey || mine.signingPublicKey !== expected.me.signingPublicKey) {
    throw new LinkProtocolError("The device list doesn't include this device with its keys");
  }
  const linker: DeviceListEntry | undefined = list.devices.find((d) => d.deviceId === linkerDeviceId);
  if (!linker || linker.deviceId === expected.me.deviceId) throw new LinkProtocolError("The linking device isn't on your device list");
  if (expected.linkerFingerprint !== undefined && signingKeyFingerprint(linker.signingPublicKey) !== expected.linkerFingerprint) {
    throw new LinkProtocolError("The linking device isn't the one whose code you scanned");
  }
  const valid = sodium.crypto_sign_verify_detached(
    fromB64(signature, "Signature"),
    welcomeSignaturePayload(channel, { newDeviceId: expected.me.deviceId, deviceList: signedList, identityPublicKey }),
    fromB64(linker.signingPublicKey, "Signing key")
  );
  if (!valid) throw new LinkProtocolError("The linking device's signature is invalid");
  return { identityPrivateKey, identityPublicKey, list };
}
