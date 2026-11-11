import { beforeEach, describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { generateKeypair, generateSecretKey, openSealedWithKeypair, sealToPublicKey } from "../crypto";
import { generateSigningKeypair, signKeyEnvelope, verifyKeyEnvelope, type DeviceListEntry } from "../deviceTrust";
import type { ContactDevices } from "../deviceIdentity";
import type { ConversationKey } from "../api";

/**
 * Per-device key protocol (mobile plan B1, B5). The server here is a fake that may serve anything:
 * rows signed by a device nobody listed, envelopes replayed from another conversation, version or
 * device, unsigned rows after the upgrade. Each case must end with this device refusing the key,
 * or at least refusing to encrypt with it.
 */

const contacts = new Map<string, ContactDevices | Error>();
const ownDevices = vi.fn<() => Promise<{ userId: string; version: number; devices: DeviceListEntry[] }>>();

vi.mock("../deviceIdentity", () => ({
  getOwnDevices: () => ownDevices(),
  getContactDevices: async (_me: string, userId: string) => {
    const value = contacts.get(userId);
    if (value instanceof Error) throw value;
    return value ?? { status: "no-identity" };
  },
  getFormerDevice: async () => null,
}));

const { KeyDistributionError, openConversationKeys, planLegacyMove, resolveMemberDevices, sealForDevices } = await import(
  "../conversationKeys"
);

type TestDevice = {
  entry: DeviceListEntry;
  enc: { publicKey: string; privateKey: string };
  sign: { publicKey: string; privateKey: string };
};

async function device(deviceId: string): Promise<TestDevice> {
  const enc = await generateKeypair();
  const sign = await generateSigningKeypair();
  return {
    entry: { deviceId, encryptionPublicKey: enc.publicKey, signingPublicKey: sign.publicKey, name: deviceId, addedAt: 1 },
    enc,
    sign,
  };
}

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const OTHER_CONVERSATION = "22222222-2222-4222-8222-222222222222";

let mine: TestDevice;
let myPhone: TestDevice;
let ada: TestDevice;
let rogue: TestDevice;

const me = () => ({ userId: "me", deviceId: mine.entry.deviceId, encryption: mine.enc, signingPrivateKey: mine.sign.privateKey });
const conversation = (memberIds = ["me", "ada"]) => ({ id: CONVERSATION, members: memberIds.map((userId) => ({ userId })) });

/**
 * Lists as this device would verify them: current devices per user, devices that have since
 * left, and which users this device already pinned (everyone, unless `pinned` is given).
 */
function lookup(current: Record<string, DeviceListEntry[]>, former: Record<string, DeviceListEntry> = {}, pinned?: string[]) {
  const known = (userId: string) => userId === "me" || !pinned || pinned.includes(userId);
  return {
    current: async (userId: string, { knownOnly }: { knownOnly: boolean }) => (knownOnly && !known(userId) ? null : current[userId] ?? null),
    former: async (userId: string, deviceId: string) => (known(userId) ? former[deviceId] ?? null : null),
  };
}

/** A row as the server would return it; `signed` lets a test sign different fields than the row claims. */
async function row(params: {
  secretKey: string;
  keyVersion: number;
  issuer: TestDevice;
  issuerUserId: string;
  recipient?: TestDevice;
  signed?: Partial<{ conversationId: string; keyVersion: number; recipientDeviceId: string }>;
}): Promise<ConversationKey> {
  const recipient = params.recipient ?? mine;
  const sealedKey = await sealToPublicKey(params.secretKey, recipient.enc.publicKey);
  const signature = await signKeyEnvelope(
    {
      conversationId: params.signed?.conversationId ?? CONVERSATION,
      keyVersion: params.signed?.keyVersion ?? params.keyVersion,
      recipientDeviceId: params.signed?.recipientDeviceId ?? recipient.entry.deviceId,
      sealedKey,
    },
    params.issuer.sign.privateKey
  );
  return {
    id: `row-${Math.random()}`,
    conversationId: CONVERSATION,
    userId: "me",
    encryptedGroupKey: sealedKey,
    keyVersion: params.keyVersion,
    createdAt: "",
    updatedAt: "",
    deviceId: recipient.entry.deviceId,
    issuerDeviceId: params.issuer.entry.deviceId,
    signature,
    issuerUserId: params.issuerUserId,
    legacy: false,
  };
}

async function legacyRow(secretKey: string, keyVersion: number, sealedTo: TestDevice = mine): Promise<ConversationKey> {
  return {
    id: `legacy-${keyVersion}`,
    conversationId: CONVERSATION,
    userId: "me",
    encryptedGroupKey: await sealToPublicKey(secretKey, sealedTo.enc.publicKey),
    keyVersion,
    createdAt: "",
    updatedAt: "",
    deviceId: null,
    issuerDeviceId: null,
    signature: null,
    issuerUserId: null,
    legacy: true,
  };
}

beforeEach(async () => {
  await sodium.ready;
  mine = await device("dev-mine");
  myPhone = await device("dev-phone");
  ada = await device("dev-ada");
  rogue = await device("dev-rogue");
  contacts.clear();
  ownDevices.mockReset().mockResolvedValue({ userId: "me", version: 2, devices: [mine.entry, myPhone.entry] });
});

describe("opening keys", () => {
  it("opens a key a member's listed device signed for this device, and may send with it", async () => {
    const secretKey = await generateSecretKey();
    const opened = await openConversationKeys({
      rows: [await row({ secretKey, keyVersion: 1, issuer: ada, issuerUserId: "ada" })],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry] }),
    });
    expect(opened.byVersion).toEqual({ 1: secretKey });
    expect(opened).toMatchObject({ newestVersion: 1, newestSendable: true, rejected: 0 });
  });

  it("refuses a key signed by a device on nobody's list (one the server added)", async () => {
    const opened = await openConversationKeys({
      rows: [await row({ secretKey: await generateSecretKey(), keyVersion: 1, issuer: rogue, issuerUserId: "ada" })],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry] }),
    });
    expect(opened.byVersion).toEqual({});
    expect(opened).toMatchObject({ newestSendable: false, rejected: 1 });
  });

  it("refuses a row whose signature was made by another key than the named issuer's", async () => {
    const forged = await row({ secretKey: await generateSecretKey(), keyVersion: 1, issuer: rogue, issuerUserId: "ada" });
    forged.issuerDeviceId = ada.entry.deviceId;
    const opened = await openConversationKeys({
      rows: [forged],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry] }),
    });
    expect(opened.byVersion).toEqual({});
    expect(opened).toMatchObject({ rejected: 1 });
  });

  it("refuses envelopes replayed from another conversation, version or device", async () => {
    const secretKey = await generateSecretKey();
    const rows = [
      await row({ secretKey, keyVersion: 1, issuer: ada, issuerUserId: "ada", signed: { conversationId: OTHER_CONVERSATION } }),
      await row({ secretKey, keyVersion: 2, issuer: ada, issuerUserId: "ada", signed: { keyVersion: 1 } }),
      await row({ secretKey, keyVersion: 3, issuer: ada, issuerUserId: "ada", signed: { recipientDeviceId: myPhone.entry.deviceId } }),
    ];
    const opened = await openConversationKeys({
      rows,
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry] }),
    });
    expect(opened.byVersion).toEqual({});
    expect(opened).toMatchObject({ newestVersion: 3, newestSendable: false, rejected: 3 });
  });

  it("ignores rows addressed to other devices and rows missing a signature", async () => {
    const secretKey = await generateSecretKey();
    const forPhone = await row({ secretKey, keyVersion: 1, issuer: ada, issuerUserId: "ada", recipient: myPhone });
    const unsigned = await row({ secretKey, keyVersion: 1, issuer: ada, issuerUserId: "ada" });
    unsigned.signature = null;
    const opened = await openConversationKeys({
      rows: [forPhone, unsigned],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry] }),
    });
    expect(opened.byVersion).toEqual({});
    expect(opened).toMatchObject({ rejected: 1 });
  });

  it("ignores unsigned legacy rows once the move is done, but still notices a newer version exists", async () => {
    const signedKey = await generateSecretKey();
    const opened = await openConversationKeys({
      rows: [await row({ secretKey: signedKey, keyVersion: 1, issuer: ada, issuerUserId: "ada" }), await legacyRow(await generateSecretKey(), 2)],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry] }),
    });
    // The legacy row is never opened, and its presence forces a rotation before the next send.
    expect(opened.byVersion).toEqual({ 1: signedKey });
    expect(opened).toMatchObject({ newestVersion: 2, newestSendable: false, legacyVersions: [] });
  });

  it("reads legacy rows during the move, for history only", async () => {
    const legacyKey = await generateSecretKey();
    const opened = await openConversationKeys({
      rows: [await legacyRow(legacyKey, 1)],
      conversation: conversation(),
      me: me(),
      allowLegacy: true,
      issuers: lookup({}),
    });
    expect(opened.byVersion).toEqual({ 1: legacyKey });
    expect(opened).toMatchObject({ legacyVersions: [1], newestSendable: false });
  });

  it("never believes a stranger the server names as issuer, even with a valid signature from their own device", async () => {
    // Mallory was never in the chat and this device has never seen her: her real, validly signed
    // envelope must not become history here.
    const opened = await openConversationKeys({
      rows: [await row({ secretKey: await generateSecretKey(), keyVersion: 1, issuer: rogue, issuerUserId: "mallory" })],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry], mallory: [rogue.entry] }, { [rogue.entry.deviceId]: rogue.entry }, ["ada"]),
    });
    expect(opened.byVersion).toEqual({});
    expect(opened.rejected).toBe(1);
  });

  it("only looks a non-member up if already pinned (so a stranger isn't pinned on first sight)", async () => {
    const asked: Array<[string, boolean]> = [];
    const spy = {
      current: async (userId: string, { knownOnly }: { knownOnly: boolean }) => {
        asked.push([userId, knownOnly]);
        return null;
      },
      former: async () => null,
    };
    await openConversationKeys({
      rows: [
        await row({ secretKey: await generateSecretKey(), keyVersion: 1, issuer: rogue, issuerUserId: "mallory" }),
        await row({ secretKey: await generateSecretKey(), keyVersion: 2, issuer: ada, issuerUserId: "ada" }),
      ],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: spy,
    });
    expect(asked).toEqual([
      ["mallory", true],
      ["ada", false],
    ]);
  });

  it("keeps history from a member who left, but won't send with a key they issued", async () => {
    const secretKey = await generateSecretKey();
    const opened = await openConversationKeys({
      rows: [await row({ secretKey, keyVersion: 4, issuer: ada, issuerUserId: "ada" })],
      conversation: conversation(["me", "bob"]),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry] }),
    });
    expect(opened.byVersion).toEqual({ 4: secretKey });
    expect(opened).toMatchObject({ newestSendable: false });
  });

  it("keeps history from a device that has left its list, but won't send with its key", async () => {
    const oldKey = await generateSecretKey();
    const newKey = await generateSecretKey();
    const issuers = lookup({ ada: [ada.entry], me: [mine.entry] }, { [rogue.entry.deviceId]: rogue.entry });
    const history = await openConversationKeys({
      rows: [await row({ secretKey: oldKey, keyVersion: 1, issuer: rogue, issuerUserId: "ada" }), await row({ secretKey: newKey, keyVersion: 2, issuer: ada, issuerUserId: "ada" })],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers,
    });
    expect(history.byVersion).toEqual({ 1: oldKey, 2: newKey });
    expect(history).toMatchObject({ newestSendable: true });

    const newestFromFormer = await openConversationKeys({
      rows: [await row({ secretKey: newKey, keyVersion: 2, issuer: rogue, issuerUserId: "ada" })],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers,
    });
    expect(newestFromFormer.byVersion).toEqual({ 2: newKey });
    expect(newestFromFormer).toMatchObject({ newestSendable: false });
  });

  it("isn't fooled by a server that names the wrong user as the issuer", async () => {
    // Ada's device signed it, but the server claims a non-member issued it: no current-list match.
    const opened = await openConversationKeys({
      rows: [await row({ secretKey: await generateSecretKey(), keyVersion: 1, issuer: ada, issuerUserId: "eve" })],
      conversation: conversation(),
      me: me(),
      allowLegacy: false,
      issuers: lookup({ ada: [ada.entry], eve: [rogue.entry] }),
    });
    expect(opened.byVersion).toEqual({});
    expect(opened).toMatchObject({ rejected: 1 });
  });
});

describe("sealing keys", () => {
  it("seals one signed copy per device that only that device opens", async () => {
    const secretKey = await generateSecretKey();
    const sealed = await sealForDevices({
      conversationId: CONVERSATION,
      keyVersion: 3,
      secretKey,
      devices: [mine.entry, ada.entry, ada.entry],
      signingPrivateKey: mine.sign.privateKey,
    });
    expect(sealed.map((k) => k.deviceId)).toEqual([mine.entry.deviceId, ada.entry.deviceId]);
    const forAda = sealed[1]!;
    expect(await openSealedWithKeypair(forAda.sealedKey, ada.enc.publicKey, ada.enc.privateKey)).toBe(secretKey);
    await expect(openSealedWithKeypair(forAda.sealedKey, mine.enc.publicKey, mine.enc.privateKey)).rejects.toThrow();
    const envelope = { conversationId: CONVERSATION, keyVersion: 3, recipientDeviceId: ada.entry.deviceId, sealedKey: forAda.sealedKey };
    expect(await verifyKeyEnvelope(envelope, forAda.signature, mine.sign.publicKey)).toBe(true);
    expect(await verifyKeyEnvelope({ ...envelope, keyVersion: 4 }, forAda.signature, mine.sign.publicKey)).toBe(false);
  });

  it("resolves every linked device of every member, this user's other devices included", async () => {
    contacts.set("ada", { status: "verified", identityKey: "k", version: 1, devices: [ada.entry], addedDevices: [], removedDeviceIds: [], firstSeen: false });
    const devices = await resolveMemberDevices({
      myUserId: "me",
      token: "t",
      members: [{ userId: "ada", username: "ada" }],
    });
    expect(devices.map((d) => d.deviceId).sort()).toEqual([ada.entry.deviceId, mine.entry.deviceId, myPhone.entry.deviceId].sort());
  });

  it("seals to nobody when a member can't be sealed to, and says who and why", async () => {
    contacts.set("ada", { status: "verified", identityKey: "k", version: 1, devices: [ada.entry], addedDevices: [], removedDeviceIds: [], firstSeen: false });
    contacts.set("bob", { status: "identity-changed", pinnedIdentityKey: "old", currentIdentityKey: "new" });
    contacts.set("eve", new Error("Device list signature is invalid"));
    const members = (name: string) => [{ userId: "ada", username: "ada" }, { userId: name, username: name }];

    await expect(resolveMemberDevices({ myUserId: "me", token: "t", members: members("bob") })).rejects.toMatchObject({
      reason: "identity-changed",
      userId: "bob",
      message: expect.stringContaining("@bob's security key changed"),
    });
    await expect(resolveMemberDevices({ myUserId: "me", token: "t", members: members("cy") })).rejects.toMatchObject({ reason: "no-identity" });
    await expect(resolveMemberDevices({ myUserId: "me", token: "t", members: members("eve") })).rejects.toBeInstanceOf(KeyDistributionError);
  });

  it("refuses to seal when this device can't verify its own user's list", async () => {
    ownDevices.mockRejectedValueOnce(new Error("This device isn't linked to your account yet."));
    await expect(resolveMemberDevices({ myUserId: "me", token: "t", members: [] })).rejects.toThrow(/isn't linked/);
  });
});

describe("the one-time legacy move", () => {
  it("re-seals the versions this device can open to all its user's devices, signed, from the readable floor up", async () => {
    const v1 = await generateSecretKey();
    const v2 = await generateSecretKey();
    const v3 = await generateSecretKey();
    const planned = await planLegacyMove({
      conversationId: CONVERSATION,
      rows: [
        await legacyRow(v1, 1),
        await legacyRow(v2, 2),
        await legacyRow(v3, 3, myPhone), // sealed to the phone: the phone moves it
        await row({ secretKey: v2, keyVersion: 2, issuer: ada, issuerUserId: "ada" }),
      ],
      minReadableKeyVersion: 2,
      me: me(),
      ownDevices: [mine.entry, myPhone.entry],
    });
    expect(planned.map((k) => [k.keyVersion, k.deviceId])).toEqual([
      [2, mine.entry.deviceId],
      [2, myPhone.entry.deviceId],
    ]);
    const forPhone = planned[1]!;
    expect(await openSealedWithKeypair(forPhone.sealedKey, myPhone.enc.publicKey, myPhone.enc.privateKey)).toBe(v2);
    expect(
      await verifyKeyEnvelope(
        { conversationId: CONVERSATION, keyVersion: 2, recipientDeviceId: myPhone.entry.deviceId, sealedKey: forPhone.sealedKey },
        forPhone.signature,
        mine.sign.publicKey
      )
    ).toBe(true);
  });
});
