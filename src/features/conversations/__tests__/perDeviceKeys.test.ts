// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { decryptChunkedBytes, decryptMessage, generateKeypair, generateSecretKey, openSealedWithKeypair } from "../../../lib/crypto";
import { generateSigningKeypair, verifyKeyEnvelope, verifyMessageSignature, type DeviceListEntry } from "../../../lib/deviceTrust";
import type { ContactDevices } from "../../../lib/deviceIdentity";
import { dm, group } from "./fixtures";

/**
 * The per-device key flows end to end against a fake server (mobile plan M1b): every key write
 * seals one signed copy per linked device, re-seals when the server reports a newer version or a
 * changed device list, rotates before sending when the chat needs it, and recovers a send the
 * server refused because the key changed.
 */

const api = {
  createConversation: vi.fn(),
  addMembers: vi.fn(),
  removeMember: vi.fn(),
  leaveGroupChat: vi.fn(),
  rotateConversationKey: vi.fn(),
  getConversations: vi.fn(),
  requestMediaUploadUrl: vi.fn(),
  uploadEncryptedBlob: vi.fn(),
};
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)])),
}));

const contacts = new Map<string, ContactDevices>();
vi.mock("../../../lib/deviceIdentity", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/deviceIdentity")>()),
  getOwnDevices: async () => ({ userId: "me", version: 1, devices: ownList }),
  getContactDevices: async (_me: string, userId: string) => contacts.get(userId) ?? { status: "no-identity" },
}));

const { ApiError, KEY_ERROR } = await import("../../../lib/api");
const { createGroup, addGroupMembers, removeGroupMember, leaveGroup } = await import("../../groups/groupKeys");
const { startDirectMessage } = await import("../startDirectMessage");
const { ensureSendableKey, requestMissingKey } = await import("../conversationKeyOps");
const { useConversationsStore } = await import("../conversationsStore");
const { useE2EEStore } = await import("../../../stores/e2eeStore");
const { useAuthStore } = await import("../../../stores/authStore");
const { useSocketStore } = await import("../../../stores/socketStore");
const { useOutboxStore } = await import("../../composer/outboxStore");
const { usePrefsStore } = await import("../../../stores/prefsStore");
const { useContactTrustStore } = await import("../../chat/contactTrust");

type TestDevice = { entry: DeviceListEntry; enc: { publicKey: string; privateKey: string }; sign: { publicKey: string; privateKey: string } };

async function device(deviceId: string): Promise<TestDevice> {
  const enc = await generateKeypair();
  const sign = await generateSigningKeypair();
  return { entry: { deviceId, encryptionPublicKey: enc.publicKey, signingPublicKey: sign.publicKey, name: deviceId, addedAt: 1 }, enc, sign };
}

const devices: Record<string, TestDevice> = {};
for (const id of ["dev-me", "dev-my-phone", "dev-ada", "dev-ada-phone", "dev-bob", "dev-cy"]) devices[id] = await device(id);
let ownList: DeviceListEntry[] = [];
const me = { id: "me" };

function verified(...ids: string[]): ContactDevices {
  return { status: "verified", identityKey: "k", version: 1, devices: ids.map((id) => devices[id]!.entry), addedDevices: [], removedDeviceIds: [], firstSeen: false };
}

/** Checks a key write: exactly `deviceIds`, each signed by this device for `conversationId`/`keyVersion`, all one key. */
async function expectKeyWrite(write: { keyVersion: number; deviceKeys: Array<{ deviceId: string; sealedKey: string; signature: string }> }, conversationId: string, keyVersion: number, deviceIds: string[]) {
  expect(write.keyVersion).toBe(keyVersion);
  expect(write.deviceKeys.map((k) => k.deviceId).sort()).toEqual([...deviceIds].sort());
  const secrets = new Set<string>();
  for (const key of write.deviceKeys) {
    const recipient = devices[key.deviceId]!;
    expect(
      await verifyKeyEnvelope({ conversationId, keyVersion, recipientDeviceId: key.deviceId, sealedKey: key.sealedKey }, key.signature, devices["dev-me"]!.sign.publicKey)
    ).toBe(true);
    secrets.add(await openSealedWithKeypair(key.sealedKey, recipient.enc.publicKey, recipient.enc.privateKey));
  }
  expect(secrets.size).toBe(1);
  return [...secrets][0]!;
}

beforeEach(async () => {
  await sodium.ready;
  useContactTrustStore.getState().reset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.getConversations.mockResolvedValue([]);
  ownList = [devices["dev-me"]!.entry, devices["dev-my-phone"]!.entry];
  contacts.clear();
  contacts.set("ada", verified("dev-ada", "dev-ada-phone"));
  contacts.set("bob", verified("dev-bob"));
  contacts.set("cy", verified("dev-cy"));
  useConversationsStore.getState().reset();
  usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate("me");
  useE2EEStore.getState().reset();
  useE2EEStore.setState({
    perDeviceKeysByUserId: { me: true },
    thisDevice: vi.fn(async () => ({ userId: "me", deviceId: "dev-me", encryption: devices["dev-me"]!.enc, signingPrivateKey: devices["dev-me"]!.sign.privateKey })),
    // The newest version on the fake server; tests change it.
    ensureConversationSecretKey: vi.fn(async ({ conversation }: { conversation: { id: string } }) => useE2EEStore.getState().secretKeyByConversationId[conversation.id] ?? null),
  });
});

describe("creating chats", () => {
  it("creates a group with a client-chosen ID and one signed copy per linked device", async () => {
    api.createConversation.mockImplementation(async (body: { conversationId: string }) => group(body.conversationId, ["ada", "bob"], { name: "Crew" }));
    const conversation = await createGroup({ name: "Crew", members: [{ id: "ada", username: "ada" }, { id: "bob", username: "bob" }], me, token: "t" });

    const body = api.createConversation.mock.calls[0]![0];
    expect(body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.encryptedKeys).toBeUndefined();
    const secret = await expectKeyWrite(body, body.conversationId, 1, ["dev-me", "dev-my-phone", "dev-ada", "dev-ada-phone", "dev-bob"]);
    expect(conversation.id).toBe(body.conversationId);
    expect(useE2EEStore.getState().getConversationSecretKeyForVersion(conversation.id, 1)).toBe(secret);
    expect(useE2EEStore.getState().sendableByConversationId[conversation.id]).toBe(true);
  });

  it("creates nothing when a member's identity changed, and says so", async () => {
    contacts.set("bob", { status: "identity-changed", pinnedIdentityKey: "a", currentIdentityKey: "b" });
    await expect(createGroup({ name: "", members: [{ id: "bob", username: "bob" }], me, token: "t" })).rejects.toThrow("@bob's security key changed");
    expect(api.createConversation).not.toHaveBeenCalled();
  });

  it("starts a DM with keys for both people's devices, and leaves an existing DM's keys alone", async () => {
    api.createConversation.mockImplementationOnce(async (body: { conversationId: string }) => dm(body.conversationId, "ada"));
    const created = await startDirectMessage({ target: { id: "ada", username: "ada" }, me, token: "t" });
    const body = api.createConversation.mock.calls[0]![0];
    await expectKeyWrite(body, created.id, 1, ["dev-me", "dev-my-phone", "dev-ada", "dev-ada-phone"]);

    useConversationsStore.getState().reset();
    api.createConversation.mockResolvedValueOnce({ ...dm("existing-dm", "bob"), created: false });
    const existing = await startDirectMessage({ target: { id: "bob", username: "bob" }, me, token: "t" });
    expect(existing.id).toBe("existing-dm");
    expect(useE2EEStore.getState().getConversationSecretKeyForVersion("existing-dm", 1)).toBeNull();
  });
});

describe("membership changes", () => {
  it("re-seals for the version the server expects when someone rotated first", async () => {
    useE2EEStore.setState({ keyVersionByConversationId: { g: 2 } });
    api.addMembers
      .mockRejectedValueOnce(new ApiError("conflict", 409, { code: KEY_ERROR.versionConflict, expectedKeyVersion: 5 }))
      .mockResolvedValueOnce({ success: true });
    await addGroupMembers({ conversation: group("g", ["ada"]), members: [{ id: "bob", username: "bob" }], me, token: "t" });

    const [first, second] = api.addMembers.mock.calls.map((call) => call[1]);
    expect(first.keyVersion).toBe(3);
    // The versions someone else issued in between are fetched, so their messages stay readable.
    expect(useE2EEStore.getState().ensureConversationSecretKey).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
    expect(second.memberIds).toEqual(["bob"]);
    const secret = await expectKeyWrite(second, "g", 5, ["dev-me", "dev-my-phone", "dev-ada", "dev-ada-phone", "dev-bob"]);
    expect(useE2EEStore.getState().getConversationSecretKeyForVersion("g", 5)).toBe(secret);
  });

  it("refetches membership and device lists once when they changed while sealing", async () => {
    const stale = group("g", ["ada", "bob"], { createdBy: "me" });
    useConversationsStore.getState().upsert(stale);
    useE2EEStore.setState({ keyVersionByConversationId: { g: 1 } });
    // Cy joined in the meantime and Ada linked a new phone.
    api.getConversations.mockResolvedValue([group("g", ["ada", "bob", "cy"], { createdBy: "me" })]);
    api.removeMember
      .mockRejectedValueOnce(new ApiError("Missing keys for 2 linked device(s)", 400, { code: KEY_ERROR.deviceListChanged }))
      .mockResolvedValueOnce({ success: true });
    await removeGroupMember({ conversation: stale, userId: "bob", me, token: "t" });

    const [, userId, write] = api.removeMember.mock.calls[1]!;
    expect(userId).toBe("bob");
    await expectKeyWrite(write, "g", 2, ["dev-me", "dev-my-phone", "dev-ada", "dev-ada-phone", "dev-cy"]);
  });

  it("gives up after a few conflicts instead of looping", async () => {
    api.rotateConversationKey.mockRejectedValue(new ApiError("conflict", 409, { code: KEY_ERROR.versionConflict, expectedKeyVersion: 9 }));
    await expect(ensureSendableKey({ conversation: group("g", ["ada"], { rotationRequired: true }), myUserId: "me", token: "t" })).rejects.toThrow("conflict");
    expect(api.rotateConversationKey).toHaveBeenCalledTimes(4);
  });

  it("leaves without issuing a key (the server flags the chat for rotation)", async () => {
    await leaveGroup({ conversation: group("g", ["ada"]), wipeMessages: false, me, token: "t" });
    expect(api.leaveGroupChat).toHaveBeenCalledWith("g", false, "t");
  });
});

describe("unreviewed identity changes", () => {
  it("won't send in a group where another member's new identity hasn't been reviewed, even with a valid key", async () => {
    // Charlie accepted Ada's reset and rotated; this user hasn't reviewed it yet.
    contacts.set("ada", { status: "identity-changed", pinnedIdentityKey: "old", currentIdentityKey: "new" });
    const conversation = group("g", ["ada", "bob"]);
    useConversationsStore.getState().upsert(conversation);
    useE2EEStore.setState({ keyVersionByConversationId: { g: 2 }, secretKeyByConversationId: { g: "k2" }, secretKeyByConversationIdAndVersion: { g: { 2: "k2" } }, sendableByConversationId: { g: true } });
    await expect(ensureSendableKey({ conversation, myUserId: "me", token: "t" })).rejects.toThrow("@ada's security key changed");
    expect(api.rotateConversationKey).not.toHaveBeenCalled();
  });
});

describe("missing key versions", () => {
  it("refetches when a message needs a version this device skipped, at most every 15 seconds", async () => {
    useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
    useConversationsStore.getState().upsert(group("g", ["ada"]));
    useConversationsStore.getState().upsert(group("empty", ["ada"]));
    useE2EEStore.setState({ secretKeyByConversationIdAndVersion: { g: { 1: "k1", 3: "k3" } } });
    const load = useE2EEStore.getState().ensureConversationSecretKey as ReturnType<typeof vi.fn>;
    load.mockClear();

    requestMissingKey("g", 3); // held: nothing to do
    expect(load).not.toHaveBeenCalled();
    requestMissingKey("g", 2);
    requestMissingKey("g", 2);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
    // A chat with no keys at all is left to its own load and error message.
    requestMissingKey("empty", 1);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("sending", () => {
  it("rotates first after a member left, then sends with the new key and clears the flag", async () => {
    const flagged = group("g", ["ada"], { rotationRequired: true });
    useConversationsStore.getState().upsert(flagged);
    useE2EEStore.setState({ keyVersionByConversationId: { g: 4 }, secretKeyByConversationId: { g: "old" }, secretKeyByConversationIdAndVersion: { g: { 4: "old" } }, sendableByConversationId: { g: true } });
    api.rotateConversationKey.mockResolvedValue({ conversationId: "g", keyVersion: 5 });

    const sendable = await ensureSendableKey({ conversation: flagged, myUserId: "me", token: "t" });
    const secret = await expectKeyWrite(api.rotateConversationKey.mock.calls[0]![1], "g", 5, ["dev-me", "dev-my-phone", "dev-ada", "dev-ada-phone"]);
    expect(sendable).toEqual({ secretKey: secret, keyVersion: 5 });
    expect(useConversationsStore.getState().conversations[0]!.rotationRequired).toBe(false);

    // Nothing left to rotate for: the next send uses the same key.
    await ensureSendableKey({ conversation: useConversationsStore.getState().conversations[0]!, myUserId: "me", token: "t" });
    expect(api.rotateConversationKey).toHaveBeenCalledTimes(1);
  });

  it("rotates rather than encrypt with a key this device may not send with", async () => {
    const conversation = group("g", ["ada"]);
    useConversationsStore.getState().upsert(conversation);
    useE2EEStore.setState({ keyVersionByConversationId: { g: 2 }, secretKeyByConversationId: { g: "legacy" }, secretKeyByConversationIdAndVersion: { g: { 2: "legacy" } }, sendableByConversationId: { g: false } });
    api.rotateConversationKey.mockResolvedValue({ conversationId: "g", keyVersion: 3 });
    expect((await ensureSendableKey({ conversation, myUserId: "me", token: "t" }))?.keyVersion).toBe(3);
  });

  it("re-encrypts and resends once when the server says the key changed, re-wrapping uploaded files", async () => {
    const emit = vi.fn();
    useSocketStore.setState({ socket: { emit } as never });
    useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
    const conversation = group("g", ["ada"]);
    useConversationsStore.getState().upsert(conversation);
    const v1 = await generateSecretKey();
    useE2EEStore.setState({ keyVersionByConversationId: { g: 1 }, secretKeyByConversationId: { g: v1 }, secretKeyByConversationIdAndVersion: { g: { 1: v1 } }, sendableByConversationId: { g: true } });
    api.requestMediaUploadUrl.mockResolvedValue({ mediaId: "media-1", uploadUrl: "https://upload", storageKey: "k" });
    api.uploadEncryptedBlob.mockResolvedValue(undefined);
    api.rotateConversationKey.mockResolvedValue({ conversationId: "g", keyVersion: 2 });

    const file = new File([new TextEncoder().encode("holiday photo")], "a.png", { type: "image/png" });
    await useOutboxStore.getState().send({ conversationId: "g", text: "look", files: [file], gif: null, parentMessageId: null });
    expect(emit.mock.calls[0]![1]).toMatchObject({ keyVersion: 1, mediaIds: ["media-1"] });

    // Ada left between our key check and the send.
    useOutboxStore.getState().handleSendError({ message: "rotate", code: KEY_ERROR.rotationRequired, conversationId: "g" });
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2));
    const resent = emit.mock.calls[1]![1];
    expect(resent).toMatchObject({ keyVersion: 2, mediaIds: ["media-1"] });
    // Same message ID across the re-encrypt (so the server can't store it twice), freshly signed by this device (B9).
    expect(resent.messageId).toBe(emit.mock.calls[0]![1].messageId);
    expect(
      await verifyMessageSignature(
        { conversationId: "g", keyVersion: 2, messageId: resent.messageId, nonce: resent.nonce, cipherText: resent.ciphertext },
        resent.signature,
        devices["dev-me"]!.sign.publicKey
      )
    ).toBe(true);
    expect(api.uploadEncryptedBlob).toHaveBeenCalledTimes(1); // re-wrapped, not re-uploaded

    const v2 = useE2EEStore.getState().getConversationSecretKeyForVersion("g", 2)!;
    const envelope = JSON.parse(await decryptMessage(resent.ciphertext, resent.nonce, v2));
    const fileKey = await decryptMessage(envelope.attachments[0].fileKeyCiphertext, envelope.attachments[0].fileKeyNonce, v2);
    const uploaded = new Uint8Array(await (api.uploadEncryptedBlob.mock.calls[0]![1] as Blob).arrayBuffer());
    expect(new TextDecoder().decode(await decryptChunkedBytes(uploaded, fileKey))).toBe("holiday photo");

    // A second key error doesn't loop: the message fails, and a manual retry re-encrypts.
    useOutboxStore.getState().handleSendError({ message: "stale", code: KEY_ERROR.staleKeyVersion, conversationId: "g" });
    const entry = useOutboxStore.getState().entries[0]!;
    expect(entry).toMatchObject({ status: "failed", payload: null, error: expect.stringContaining("key changed") });
    useOutboxStore.getState().reset();
  });

  it("never re-sends the refused ciphertext when the automatic re-encrypt fails", async () => {
    const emit = vi.fn();
    useSocketStore.setState({ socket: { emit } as never });
    useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
    useConversationsStore.getState().upsert(group("g", ["ada"]));
    const v1 = await generateSecretKey();
    useE2EEStore.setState({ keyVersionByConversationId: { g: 1 }, secretKeyByConversationId: { g: v1 }, secretKeyByConversationIdAndVersion: { g: { 1: v1 } }, sendableByConversationId: { g: true } });
    await useOutboxStore.getState().send({ conversationId: "g", text: "hi", files: [], gif: null, parentMessageId: null });
    const refused = emit.mock.calls[0]![1].ciphertext;

    api.rotateConversationKey.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ conversationId: "g", keyVersion: 2 });
    useOutboxStore.getState().handleSendError({ code: KEY_ERROR.rotationRequired, conversationId: "g" });
    await vi.waitFor(() => expect(useOutboxStore.getState().entries[0]!.status).toBe("failed"));
    expect(useOutboxStore.getState().entries[0]!.payload).toBeNull();

    await useOutboxStore.getState().retry(useOutboxStore.getState().entries[0]!.localId);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1]![1]).toMatchObject({ keyVersion: 2 });
    expect(emit.mock.calls[1]![1].ciphertext).not.toBe(refused);
    useOutboxStore.getState().reset();
  });

  it("explains a refused send from a device that isn't linked", async () => {
    const emit = vi.fn();
    useSocketStore.setState({ socket: { emit } as never });
    useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
    useConversationsStore.getState().upsert(group("g", ["ada"]));
    useE2EEStore.setState({ keyVersionByConversationId: { g: 1 }, secretKeyByConversationId: { g: "k" }, secretKeyByConversationIdAndVersion: { g: { 1: await generateSecretKey() } }, sendableByConversationId: { g: true } });
    await useOutboxStore.getState().send({ conversationId: "g", text: "hi", files: [], gif: null, parentMessageId: null });
    useOutboxStore.getState().handleSendError({ message: "no", code: KEY_ERROR.deviceNotLinked, conversationId: "g" });
    expect(useOutboxStore.getState().entries[0]!.error).toMatch(/isn't linked/);
    useOutboxStore.getState().reset();
  });
});
