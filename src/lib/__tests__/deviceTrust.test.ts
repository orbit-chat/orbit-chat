import { describe, it, expect, beforeAll } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair } from "../crypto";
import {
  generateSigningKeypair,
  signingPublicKeyFromPrivateKey,
  signDeviceList,
  verifyDeviceList,
  signKeyEnvelope,
  verifyKeyEnvelope,
  signMessage,
  verifyMessageSignature,
  identityFingerprint,
  safetyNumber,
  type DeviceList,
  type SigningKeypair,
} from "../deviceTrust";

/**
 * Device trust is what stops the server from adding its own device to an account. As with
 * crypto.test.ts, the rejections matter more than the round-trips: accepting a forged or replayed
 * device list would silently hand every contact's conversation keys to an attacker.
 */

const USER_ID = "8d3c6c3e-5a0b-4f7e-9a51-2f0c8a7d1b11";

let identity: SigningKeypair;
let list: DeviceList;

async function makeDevice(deviceId: string, name: string) {
  const enc = await generateKeypair();
  const sig = await generateSigningKeypair();
  return {
    entry: { deviceId, encryptionPublicKey: enc.publicKey, signingPublicKey: sig.publicKey, name, addedAt: 1761235200123 },
    signing: sig,
  };
}

function flipByte(base64: string, index = 0) {
  const bytes = sodium.from_base64(base64);
  bytes[index] ^= 0x01;
  return sodium.to_base64(bytes);
}

beforeAll(async () => {
  await sodium.ready;
  identity = await generateSigningKeypair();
  const desktop = await makeDevice("b-desktop", "Orbit Desktop");
  const phone = await makeDevice("a-phone", "Orbit iOS");
  list = { userId: USER_ID, version: 3, devices: [desktop.entry, phone.entry] };
});

describe("signing keys", () => {
  it("derives the signing public key from the private key", async () => {
    expect(await signingPublicKeyFromPrivateKey(identity.privateKey)).toBe(identity.publicKey);
  });

  it("rejects a private key of the wrong length", async () => {
    const box = await generateKeypair(); // 32-byte X25519 key, not a 64-byte Ed25519 key
    await expect(signingPublicKeyFromPrivateKey(box.privateKey)).rejects.toThrow();
  });

  it("rejects a private key whose embedded public half doesn't match its seed", async () => {
    await expect(signingPublicKeyFromPrivateKey(flipByte(identity.privateKey, 40))).rejects.toThrow(/corrupted/);
  });
});

describe("signed device list", () => {
  it("round-trips and sorts devices canonically", async () => {
    const signed = await signDeviceList(list, identity.privateKey);
    const verified = await verifyDeviceList(signed, identity.publicKey, { expectedUserId: USER_ID });
    expect(verified.version).toBe(3);
    expect(verified.devices.map((d) => d.deviceId)).toEqual(["a-phone", "b-desktop"]);
    expect(verified.devices[1]).toEqual(list.devices[0]);
  });

  it("encodes the same set of devices to the same bytes in any order", async () => {
    const reversed = { ...list, devices: list.devices.slice().reverse() };
    const a = await signDeviceList(list, identity.privateKey);
    const b = await signDeviceList(reversed, identity.privateKey);
    expect(a.body).toBe(b.body);
  });

  it("rejects a list signed by a different identity key", async () => {
    const attacker = await generateSigningKeypair();
    const signed = await signDeviceList(list, attacker.privateKey);
    await expect(verifyDeviceList(signed, identity.publicKey, { expectedUserId: USER_ID })).rejects.toThrow(
      /signature is invalid/
    );
  });

  it("rejects a list with a server-added device", async () => {
    const signed = await signDeviceList(list, identity.privateKey);
    const injected = await makeDevice("c-server", "Orbit Desktop");
    const forged = await signDeviceList({ ...list, devices: [...list.devices, injected.entry] }, identity.privateKey);
    // Keep the genuine signature but swap in the longer body.
    await expect(
      verifyDeviceList({ body: forged.body, signature: signed.signature }, identity.publicKey, { expectedUserId: USER_ID })
    ).rejects.toThrow(/signature is invalid/);
  });

  it("rejects any tampered byte in the body or signature", async () => {
    const signed = await signDeviceList(list, identity.privateKey);
    const bodyLength = sodium.from_base64(signed.body).length;
    for (const index of [0, 30, bodyLength - 1]) {
      await expect(
        verifyDeviceList({ ...signed, body: flipByte(signed.body, index) }, identity.publicKey, { expectedUserId: USER_ID })
      ).rejects.toThrow();
    }
    await expect(
      verifyDeviceList({ ...signed, signature: flipByte(signed.signature) }, identity.publicKey, { expectedUserId: USER_ID })
    ).rejects.toThrow();
  });

  it("rejects a truncated signature", async () => {
    const signed = await signDeviceList(list, identity.privateKey);
    const short = sodium.to_base64(sodium.from_base64(signed.signature).slice(0, 63));
    await expect(
      verifyDeviceList({ ...signed, signature: short }, identity.publicKey, { expectedUserId: USER_ID })
    ).rejects.toThrow(/signature is invalid/);
  });

  it("rejects a list replayed from an older version", async () => {
    const signed = await signDeviceList(list, identity.privateKey);
    await expect(
      verifyDeviceList(signed, identity.publicKey, { expectedUserId: USER_ID, minVersion: 4 })
    ).rejects.toThrow(/older/);
    await expect(
      verifyDeviceList(signed, identity.publicKey, { expectedUserId: USER_ID, minVersion: 3 })
    ).resolves.toBeTruthy();
  });

  it("rejects a valid list presented as another user's", async () => {
    const signed = await signDeviceList(list, identity.privateKey);
    await expect(
      verifyDeviceList(signed, identity.publicKey, { expectedUserId: "someone-else" })
    ).rejects.toThrow(/different user/);
  });

  it("rejects a correctly signed body with trailing bytes", async () => {
    const body = sodium.from_base64((await signDeviceList(list, identity.privateKey)).body);
    const padded = new Uint8Array(body.length + 1);
    padded.set(body);
    const signature = sodium.to_base64(sodium.crypto_sign_detached(padded, sodium.from_base64(identity.privateKey)));
    await expect(
      verifyDeviceList({ body: sodium.to_base64(padded), signature }, identity.publicKey, { expectedUserId: USER_ID })
    ).rejects.toThrow(/trailing/);
  });

  it("rejects a correctly signed payload made for another purpose", async () => {
    const envelope = { conversationId: "c", keyVersion: 1, recipientDeviceId: "d", sealedKey: sodium.to_base64(new Uint8Array(80)) };
    const signature = await signKeyEnvelope(envelope, identity.privateKey);
    // An envelope signature can't stand in for a device list, even from the same key.
    await expect(
      verifyDeviceList({ body: sodium.to_base64(new Uint8Array(80)), signature }, identity.publicKey, { expectedUserId: USER_ID })
    ).rejects.toThrow();
  });

  it("refuses to sign an empty list, duplicate devices or malformed keys", async () => {
    await expect(signDeviceList({ ...list, devices: [] }, identity.privateKey)).rejects.toThrow();
    await expect(
      signDeviceList({ ...list, devices: [list.devices[0]!, list.devices[0]!] }, identity.privateKey)
    ).rejects.toThrow(/duplicate/);
    await expect(
      signDeviceList(
        { ...list, devices: [{ ...list.devices[0]!, signingPublicKey: sodium.to_base64(new Uint8Array(31)) }] },
        identity.privateKey
      )
    ).rejects.toThrow();
  });
});

describe("key envelope signatures", () => {
  const envelope = () => ({
    conversationId: "conv-1",
    keyVersion: 2,
    recipientDeviceId: "a-phone",
    sealedKey: sodium.to_base64(sodium.randombytes_buf(80)),
  });

  it("verifies with the issuer's key and nothing else", async () => {
    const issuer = await generateSigningKeypair();
    const other = await generateSigningKeypair();
    const e = envelope();
    const signature = await signKeyEnvelope(e, issuer.privateKey);
    expect(await verifyKeyEnvelope(e, signature, issuer.publicKey)).toBe(true);
    expect(await verifyKeyEnvelope(e, signature, other.publicKey)).toBe(false);
  });

  it("binds the conversation, version, recipient device and sealed key", async () => {
    const issuer = await generateSigningKeypair();
    const e = envelope();
    const signature = await signKeyEnvelope(e, issuer.privateKey);
    const variants = [
      { ...e, conversationId: "conv-2" },
      { ...e, keyVersion: 3 },
      { ...e, recipientDeviceId: "c-server" },
      { ...e, sealedKey: flipByte(e.sealedKey, 10) },
    ];
    for (const variant of variants) {
      expect(await verifyKeyEnvelope(variant, signature, issuer.publicKey)).toBe(false);
    }
  });
});

describe("message signatures", () => {
  const message = () => ({
    conversationId: "conv-1",
    keyVersion: 1,
    messageId: "msg-1",
    nonce: sodium.to_base64(sodium.randombytes_buf(24)),
    cipherText: sodium.to_base64(sodium.randombytes_buf(120)),
  });

  it("verifies with the sending device's key and rejects any other member's", async () => {
    const sender = await generateSigningKeypair();
    const otherMember = await generateSigningKeypair();
    const m = message();
    const signature = await signMessage(m, sender.privateKey);
    expect(await verifyMessageSignature(m, signature, sender.publicKey)).toBe(true);
    expect(await verifyMessageSignature(m, signature, otherMember.publicKey)).toBe(false);
  });

  it("rejects a message replayed into another conversation or with altered ciphertext", async () => {
    const sender = await generateSigningKeypair();
    const m = message();
    const signature = await signMessage(m, sender.privateKey);
    const variants = [
      { ...m, conversationId: "conv-2" },
      { ...m, keyVersion: 2 },
      { ...m, messageId: "msg-2" },
      { ...m, nonce: flipByte(m.nonce) },
      { ...m, cipherText: flipByte(m.cipherText, 50) },
    ];
    for (const variant of variants) {
      expect(await verifyMessageSignature(variant, signature, sender.publicKey)).toBe(false);
    }
  });

  it("does not accept a key envelope signature as a message signature", async () => {
    const sender = await generateSigningKeypair();
    const sealedKey = sodium.to_base64(sodium.randombytes_buf(80));
    const signature = await signKeyEnvelope(
      { conversationId: "conv-1", keyVersion: 1, recipientDeviceId: "msg-1", sealedKey },
      sender.privateKey
    );
    expect(
      await verifyMessageSignature(
        { conversationId: "conv-1", keyVersion: 1, messageId: "msg-1", nonce: sealedKey, cipherText: sealedKey },
        signature,
        sender.publicKey
      )
    ).toBe(false);
  });
});

describe("fingerprints and safety numbers", () => {
  it("formats a fingerprint as six groups of five digits", async () => {
    const fingerprint = await identityFingerprint(USER_ID, identity.publicKey);
    expect(fingerprint).toMatch(/^(\d{5} ){5}\d{5}$/);
    expect(await identityFingerprint(USER_ID, identity.publicKey)).toBe(fingerprint);
  });

  it("changes when the identity key or the user changes", async () => {
    const other = await generateSigningKeypair();
    const base = await identityFingerprint(USER_ID, identity.publicKey);
    expect(await identityFingerprint(USER_ID, other.publicKey)).not.toBe(base);
    expect(await identityFingerprint("another-user", identity.publicKey)).not.toBe(base);
  });

  it("gives both users the same safety number", async () => {
    const bob = await generateSigningKeypair();
    const alice = { userId: USER_ID, identityPublicKey: identity.publicKey };
    const bobSide = { userId: "f-bob", identityPublicKey: bob.publicKey };
    const number = await safetyNumber(alice, bobSide);
    expect(await safetyNumber(bobSide, alice)).toBe(number);
    expect(number.replace(/ /g, "")).toHaveLength(60);
  });
});

/**
 * Wire-format vector. orbit-server's `src/modules/identity/device-list.spec.ts` verifies these
 * exact bytes, so a change here that isn't mirrored on the server fails one of the two suites.
 * Ed25519 is deterministic, so a fixed seed always gives the same signature.
 */
const DEVICE_LIST_VECTOR = {
  identityPublicKey: "A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg",
  body:
    "AAAAFG9yYml0L2RldmljZS1saXN0L3YxAAAAJDhkM2M2YzNlLTVhMGItNGY3ZS05YTUxLTJmMGM4YTdkMWIxMQAAAAcAAAACAAAAJDExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMQAAACAREREREREREREREREREREREREREREREREREREREREREQAAACCgmqX0emdZgC_5VfjcLSoUpcmdI76X-GQSf_k4NFWk8AAAAA1PcmJpdCBEZXNrdG9wAAAAAAAAAAUAAAAkMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyAAAAIDMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzAAAAIKCapfR6Z1mAL_lV-NwtKhSlyZ0jvpf4ZBJ_-Tg0VaTwAAAADkFkYeKAmXMgaVBob25lAAABmhHMaHs",
  signature: "48v8e10LMhzrxUraKq7NUhKFvHdMNqg6JAl7cY2GEOfAz0V1UCvNZT-Z9eLEKYdzMwqK74dTm1xOIkx5KP2kBg",
};

describe("device list wire format", () => {
  it("produces the pinned bytes and signature for a fixed input", async () => {
    const identityKeys = sodium.crypto_sign_seed_keypair(Uint8Array.from({ length: 32 }, (_, i) => i));
    const deviceSigning = sodium.to_base64(sodium.crypto_sign_seed_keypair(new Uint8Array(32).fill(0x22)).publicKey);
    const signed = await signDeviceList(
      {
        userId: "8d3c6c3e-5a0b-4f7e-9a51-2f0c8a7d1b11",
        version: 7,
        devices: [
          {
            deviceId: "22222222-2222-4222-8222-222222222222",
            encryptionPublicKey: sodium.to_base64(new Uint8Array(32).fill(0x33)),
            signingPublicKey: deviceSigning,
            name: "Ada\u2019s iPhone",
            addedAt: 1761235200123,
          },
          {
            deviceId: "11111111-1111-4111-8111-111111111111",
            encryptionPublicKey: sodium.to_base64(new Uint8Array(32).fill(0x11)),
            signingPublicKey: deviceSigning,
            name: "Orbit Desktop",
            addedAt: 5,
          },
        ],
      },
      sodium.to_base64(identityKeys.privateKey)
    );

    expect(sodium.to_base64(identityKeys.publicKey)).toBe(DEVICE_LIST_VECTOR.identityPublicKey);
    expect(signed).toEqual({ body: DEVICE_LIST_VECTOR.body, signature: DEVICE_LIST_VECTOR.signature });
  });
});

/**
 * Key envelope wire-format vector. orbit-server's `src/modules/keys/key-envelope.spec.ts` verifies
 * this exact signature, so the server's envelope encoder can't drift from `signKeyEnvelope`.
 */
const KEY_ENVELOPE_VECTOR = {
  signingPublicKey: "6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw",
  sealedKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk8",
  signature: "VZ16Sz9nvrxuy1MWEeFy7Wl-PaKwZPHhntH-xUIqrrIWP-T3Eh-fTNwQDvecBdLeFvqOhxVOUvZjZMoTjpJsDg",
};

describe("key envelope wire-format vector", () => {
  it("produces the pinned signature for a fixed input", async () => {
    const keys = sodium.crypto_sign_seed_keypair(new Uint8Array(32).fill(7));
    const envelope = {
      conversationId: "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      keyVersion: 3,
      recipientDeviceId: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
      sealedKey: sodium.to_base64(Uint8Array.from({ length: 80 }, (_, i) => i)),
    };
    expect(sodium.to_base64(keys.publicKey)).toBe(KEY_ENVELOPE_VECTOR.signingPublicKey);
    expect(envelope.sealedKey).toBe(KEY_ENVELOPE_VECTOR.sealedKey);
    expect(await signKeyEnvelope(envelope, sodium.to_base64(keys.privateKey))).toBe(KEY_ENVELOPE_VECTOR.signature);
  });
});

/**
 * Message signature wire-format vector (B9). orbit-server's `src/modules/messages/message-signature.spec.ts`
 * verifies this exact signature, so the server's message encoder can't drift from `signMessage`.
 */
const MESSAGE_VECTOR = {
  signingPublicKey: "_RckOFqgx1tk-3jNYC-h2ZH96_drE8WO1wLqyDXp9hg",
  signature: "xDeufZjqNji9elpT0r3FdFelO6Zg4VwOSc9Ke0qFGqkQ9Y94P_D--IReecjA3C6vcVcOQeMceIbvcY6Xo5TeBw",
};

describe("message signature wire-format vector", () => {
  it("produces the pinned signature for a fixed input", async () => {
    const keys = sodium.crypto_sign_seed_keypair(new Uint8Array(32).fill(9));
    const message = {
      conversationId: "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
      keyVersion: 2,
      messageId: "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9",
      nonce: sodium.to_base64(Uint8Array.from({ length: 24 }, (_, i) => i)),
      cipherText: sodium.to_base64(Uint8Array.from({ length: 40 }, (_, i) => 255 - i)),
    };
    expect(sodium.to_base64(keys.publicKey)).toBe(MESSAGE_VECTOR.signingPublicKey);
    expect(await signMessage(message, sodium.to_base64(keys.privateKey))).toBe(MESSAGE_VECTOR.signature);
  });
});
