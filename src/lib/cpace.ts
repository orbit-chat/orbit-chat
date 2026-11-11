import sodium from "libsodium-wrappers-sumo";

/**
 * CPace (draft-irtf-cfrg-cpace-21), ciphersuite CPACE-RISTR255-SHA512, initiator-responder
 * setting. Used to turn a short typed linking code into a strong shared key (mobile plan B7):
 * whoever relays the two messages (the server) learns nothing it can brute-force offline, and an
 * active attacker gets one guess per session.
 *
 * This follows the draft's definitions exactly and is pinned to its ristretto255 test vectors in
 * `src/lib/__tests__/cpace.test.ts`. Don't change the construction without new vectors.
 */

const encoder = new TextEncoder();
/** UTF-8 bytes in this realm's Uint8Array (TextEncoder may return another realm's under jsdom, which libsodium rejects). */
const utf8 = (text: string) => new Uint8Array(encoder.encode(text));
const DSI = utf8("CPaceRistretto255");
const DSI_ISK = utf8("CPaceRistretto255_ISK");
/** SHA-512's input block size. */
const S_IN_BYTES = 128;
const POINT_BYTES = 32;

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The draft's prepend_len: the LEB128 encoding of the length, then the data. */
export function prependLen(data: Uint8Array) {
  const prefix: number[] = [];
  let length = data.length;
  for (;;) {
    prefix.push(length < 128 ? length : (length & 0x7f) + 0x80);
    length = Math.floor(length / 128);
    if (length === 0) break;
  }
  return concat(Uint8Array.from(prefix), data);
}

/** The draft's lv_cat: each argument length-prefixed, concatenated. */
export function lvCat(...args: Uint8Array[]) {
  return concat(...args.map(prependLen));
}

export function generatorString(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array) {
  const zpad = Math.max(0, S_IN_BYTES - 1 - prependLen(prs).length - prependLen(DSI).length);
  return lvCat(DSI, prs, new Uint8Array(zpad), ci, sid);
}

/** calculate_generator: SHA-512 of the generator string, mapped to a ristretto255 point. */
export function calculateGenerator(prs: Uint8Array, ci: Uint8Array, sid: Uint8Array) {
  return sodium.crypto_core_ristretto255_from_hash(sodium.crypto_hash_sha512(generatorString(prs, ci, sid)));
}

export function transcriptIr(ya: Uint8Array, ada: Uint8Array, yb: Uint8Array, adb: Uint8Array) {
  return concat(lvCat(ya, ada), lvCat(yb, adb));
}

/**
 * scalar_mult_vfy: y·X, or null where the draft returns the identity (X doesn't decode, or the
 * result is the neutral element). Callers must abort on null.
 */
export function scalarMultVfy(y: Uint8Array, x: Uint8Array): Uint8Array | null {
  if (x.length !== POINT_BYTES || !sodium.crypto_core_ristretto255_is_valid_point(x)) return null;
  try {
    // libsodium refuses (throws) when the product is the identity element.
    const k = sodium.crypto_scalarmult_ristretto255(y, x);
    return sodium.is_zero(k) ? null : k;
  } catch {
    return null;
  }
}

export class CPaceAbort extends Error {
  constructor() {
    super("CPace aborted: the other side's message is invalid");
    this.name = "CPaceAbort";
  }
}

export type CPaceRole = "initiator" | "responder";

/**
 * One side of a CPace run. `message` is this side's Y (send it with its AD); `finish` takes the
 * peer's Y and AD and returns the 64-byte ISK, or throws `CPaceAbort`. Single use: the scalar is
 * wiped after `finish`, as the draft requires scalars never be reused.
 */
export class CPaceParty {
  readonly message: Uint8Array;
  private scalar: Uint8Array | null;

  constructor(
    private readonly role: CPaceRole,
    private readonly params: { prs: Uint8Array; ci: Uint8Array; sid: Uint8Array; ad: Uint8Array },
    /** Tests only: a fixed scalar from the draft's vectors. */
    fixedScalar?: Uint8Array
  ) {
    const g = calculateGenerator(params.prs, params.ci, params.sid);
    this.scalar = fixedScalar ? fixedScalar.slice() : sodium.crypto_core_ristretto255_scalar_random();
    this.message = sodium.crypto_scalarmult_ristretto255(this.scalar, g);
  }

  finish(peerY: Uint8Array, peerAd: Uint8Array): Uint8Array {
    if (!this.scalar) throw new Error("This CPace run has already finished");
    const k = scalarMultVfy(this.scalar, peerY);
    sodium.memzero(this.scalar);
    this.scalar = null;
    if (!k) throw new CPaceAbort();
    const transcript =
      this.role === "initiator"
        ? transcriptIr(this.message, this.params.ad, peerY, peerAd)
        : transcriptIr(peerY, peerAd, this.message, this.params.ad);
    const isk = sodium.crypto_hash_sha512(concat(lvCat(DSI_ISK, this.params.sid, k), transcript));
    sodium.memzero(k);
    return isk;
  }
}

/** Libsodium must be initialised before constructing a party. */
export const cpaceReady = sodium.ready;
