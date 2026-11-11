import { beforeEach, describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair } from "../../../lib/crypto";
import { generateSigningKeypair, signMessage, type DeviceListEntry } from "../../../lib/deviceTrust";
import type { ContactDevices } from "../../../lib/deviceIdentity";

/**
 * Message signatures (mobile plan B9). The server names the sender; only a signature that
 * verifies against one of the sender's listed devices proves it. A member forging a message as
 * someone else, the server swapping ciphertext, or a replay into another chat must all show up
 * as unverified.
 */

const contacts = new Map<string, ContactDevices>();
const former = new Map<string, DeviceListEntry>();
vi.mock("../../../lib/deviceIdentity", () => ({
  getOwnDevices: async () => {
    throw new Error("This device isn't linked to your account yet.");
  },
  getContactDevices: async (_me: string, userId: string) => {
    const value = contacts.get(userId);
    if (value instanceof Error) throw value;
    return value ?? { status: "no-identity" };
  },
  getFormerDevice: async (_me: string, _userId: string, deviceId: string) => former.get(deviceId) ?? null,
}));

const { checkMessageSigner, resetMessageSigners } = await import("../messageSigners");

async function device(deviceId: string) {
  const sign = await generateSigningKeypair();
  const entry: DeviceListEntry = { deviceId, encryptionPublicKey: (await generateKeypair()).publicKey, signingPublicKey: sign.publicKey, name: deviceId, addedAt: 1 };
  return { entry, privateKey: sign.privateKey };
}

const verified = (...devices: DeviceListEntry[]): ContactDevices => ({ status: "verified", identityKey: "k", version: 1, devices, addedDevices: [], removedDeviceIds: [], firstSeen: false });
const me = { userId: "me", token: "t" };
const CONVERSATION = "11111111-1111-4111-8111-111111111111";

async function signed(signerKey: string, deviceId: string, senderId: string, overrides: Partial<{ conversationId: string; keyVersion: number; id: string }> = {}) {
  const message = {
    id: overrides.id ?? crypto.randomUUID(),
    senderId,
    senderDeviceId: deviceId,
    keyVersion: overrides.keyVersion ?? 1,
    nonce: sodium.to_base64(sodium.randombytes_buf(24)),
    cipherText: sodium.to_base64(sodium.randombytes_buf(40)),
  };
  const signature = await signMessage(
    { conversationId: overrides.conversationId ?? CONVERSATION, keyVersion: message.keyVersion, messageId: message.id, nonce: message.nonce, cipherText: message.cipherText },
    signerKey
  );
  return { ...message, signature };
}

beforeEach(async () => {
  await sodium.ready;
  contacts.clear();
  former.clear();
  resetMessageSigners();
});

describe("checking who sent a message", () => {
  it("verifies a message signed by one of the sender's listed devices", async () => {
    const adaPhone = await device("ada-phone");
    contacts.set("ada", verified(adaPhone.entry));
    expect(await checkMessageSigner(CONVERSATION, await signed(adaPhone.privateKey, "ada-phone", "ada"), me)).toBe("verified");
  });

  it("flags a member's device signing a message the server attributes to someone else", async () => {
    const adaPhone = await device("ada-phone");
    const bobPhone = await device("bob-phone");
    contacts.set("ada", verified(adaPhone.entry));
    contacts.set("bob", verified(bobPhone.entry));
    // Bob signs with his own device but the message claims to be Ada's (and names his device).
    expect(await checkMessageSigner(CONVERSATION, await signed(bobPhone.privateKey, "bob-phone", "ada"), me)).toBe("invalid");
    // Or names Ada's device with Bob's signature.
    expect(await checkMessageSigner(CONVERSATION, await signed(bobPhone.privateKey, "ada-phone", "ada"), me)).toBe("invalid");
  });

  it("flags swapped ciphertext and a signature replayed from another chat or version", async () => {
    const adaPhone = await device("ada-phone");
    contacts.set("ada", verified(adaPhone.entry));
    const message = await signed(adaPhone.privateKey, "ada-phone", "ada");
    expect(await checkMessageSigner(CONVERSATION, { ...message, cipherText: sodium.to_base64(sodium.randombytes_buf(40)) }, me)).toBe("invalid");
    expect(await checkMessageSigner("22222222-2222-4222-8222-222222222222", message, me)).toBe("invalid");
    expect(await checkMessageSigner(CONVERSATION, { ...message, keyVersion: 2 }, me)).toBe("invalid");
  });

  it("marks a message from a since-removed device separately, and an unknown device as invalid", async () => {
    const adaOld = await device("ada-old");
    const adaPhone = await device("ada-phone");
    contacts.set("ada", verified(adaPhone.entry));
    former.set("ada-old", adaOld.entry);
    expect(await checkMessageSigner(CONVERSATION, await signed(adaOld.privateKey, "ada-old", "ada"), me)).toBe("former-device");
    const stranger = await device("stranger");
    expect(await checkMessageSigner(CONVERSATION, await signed(stranger.privateKey, "stranger", "ada"), me)).toBe("invalid");
  });

  it("can't verify anyone whose identity changed until it's reviewed", async () => {
    const adaPhone = await device("ada-phone");
    contacts.set("ada", { status: "identity-changed", pinnedIdentityKey: "a", currentIdentityKey: "b" });
    expect(await checkMessageSigner(CONVERSATION, await signed(adaPhone.privateKey, "ada-phone", "ada"), me)).toBe("invalid");
  });

  it("reports 'can't check' instead of a warning when this device can't verify the sender's list", async () => {
    const adaPhone = await device("ada-phone");
    // Not linked yet (its own list can't be verified), or the lookup failed.
    contacts.set("ada", new Error("offline") as never);
    const message = await signed(adaPhone.privateKey, "ada-phone", "ada");
    expect(await checkMessageSigner(CONVERSATION, message, me)).toBe("unknown");
    expect(await checkMessageSigner(CONVERSATION, await signed(adaPhone.privateKey, "ada-phone", "me"), me)).toBe("unknown");
  });

  it("treats unsigned messages from before signatures as legacy, not as errors", async () => {
    expect(await checkMessageSigner(CONVERSATION, { id: "m", senderId: "ada", cipherText: "x", nonce: "n", keyVersion: 1, senderDeviceId: null, signature: null }, me)).toBe("legacy");
  });
});
