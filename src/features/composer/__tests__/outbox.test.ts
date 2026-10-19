// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptChunkedBytes, decryptMessage, generateSecretKey, sha256Base64 } from "../../../lib/crypto";
import { dm } from "../../conversations/__tests__/fixtures";

const requestMediaUploadUrl = vi.fn();
const uploadEncryptedBlob = vi.fn();
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  requestMediaUploadUrl: (...args: unknown[]) => requestMediaUploadUrl(...args),
  uploadEncryptedBlob: (...args: unknown[]) => uploadEncryptedBlob(...args)
}));

const { useOutboxStore, CONFIRM_TIMEOUT_MS } = await import("../outboxStore");
const { encryptAndUpload } = await import("../encryptAttachment");
const { useAuthStore } = await import("../../../stores/authStore");
const { useSocketStore } = await import("../../../stores/socketStore");
const { useE2EEStore } = await import("../../../stores/e2eeStore");
const { useConversationsStore } = await import("../../conversations/conversationsStore");
const { useDecryptedStore } = await import("../../chat/decryptedStore");

const key = await generateSecretKey();
const emit = vi.fn();
const outbox = () => useOutboxStore.getState();
const lastPayload = () => emit.mock.calls.at(-1)![1] as { ciphertext: string; nonce: string; parentMessageId?: string; mediaIds: string[]; type: string; keyVersion: number };

beforeEach(() => {
  emit.mockReset();
  requestMediaUploadUrl.mockReset().mockResolvedValue({ mediaId: "media-1", uploadUrl: "https://upload", storageKey: "k" });
  uploadEncryptedBlob.mockReset().mockResolvedValue(undefined);
  outbox().reset();
  useDecryptedStore.getState().reset();
  useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
  useSocketStore.setState({ socket: { emit } as never });
  useConversationsStore.setState({ conversations: [dm("c", "ada")] });
  useE2EEStore.setState({ ensureConversationSecretKey: vi.fn(async () => key), getConversationKeyVersion: () => 3 });
});

afterEach(() => vi.useRealTimers());

describe("outbox", () => {
  it("encrypts and emits, and only the conversation key opens the payload", async () => {
    await outbox().send({ conversationId: "c", text: "hello", files: [], gif: null, parentMessageId: "p1" });
    expect(emit).toHaveBeenCalledWith("send_message", expect.objectContaining({ conversationId: "c", parentMessageId: "p1", keyVersion: 3, type: "text", mediaIds: [] }));
    const { ciphertext, nonce } = lastPayload();
    expect(JSON.parse(await decryptMessage(ciphertext, nonce, key))).toEqual({ text: "hello", attachments: [] });
    expect(ciphertext).not.toContain("hello");
    expect(outbox().entries[0]).toMatchObject({ status: "sending", envelope: { text: "hello" } });
  });

  it("is confirmed by the server echo and seeds the plaintext under the real id", async () => {
    await outbox().send({ conversationId: "c", text: "hi", files: [], gif: null, parentMessageId: null });
    outbox().confirm({ id: "server-1", conversationId: "c", ciphertext: "someone else's" });
    expect(outbox().entries).toHaveLength(1);
    outbox().confirm({ id: "server-1", conversationId: "c", ciphertext: lastPayload().ciphertext });
    expect(outbox().entries).toHaveLength(0);
    expect(useDecryptedStore.getState().byMessageId["server-1"]).toEqual({ status: "ok", envelope: { text: "hi", attachments: [] } });
  });

  it("fails after the timeout and retries with the same ciphertext", async () => {
    vi.useFakeTimers();
    await outbox().send({ conversationId: "c", text: "hi", files: [], gif: null, parentMessageId: null });
    const first = lastPayload();
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS + 1);
    expect(outbox().entries[0]).toMatchObject({ status: "failed", error: "The server didn't confirm this message." });

    await outbox().retry(outbox().entries[0]!.localId);
    expect(lastPayload().ciphertext).toBe(first.ciphertext);
    expect(outbox().entries[0]!.status).toBe("sending");
  });

  it("blames the oldest in-flight message for a server error, and can discard it", async () => {
    await outbox().send({ conversationId: "c", text: "one", files: [], gif: null, parentMessageId: null });
    await outbox().send({ conversationId: "c", text: "two", files: [], gif: null, parentMessageId: null });
    outbox().failOldestSending("Not a member");
    expect(outbox().entries.map((e) => [e.envelope.text, e.status])).toEqual([
      ["one", "failed"],
      ["two", "sending"]
    ]);
    outbox().discard(outbox().entries[0]!.localId);
    expect(outbox().entries.map((e) => e.envelope.text)).toEqual(["two"]);
  });

  it("fails clearly when offline or without a key", async () => {
    useSocketStore.setState({ socket: null });
    await outbox().send({ conversationId: "c", text: "x", files: [], gif: null, parentMessageId: null });
    expect(outbox().entries[0]!.error).toMatch(/offline/);

    outbox().reset();
    useSocketStore.setState({ socket: { emit } as never });
    useE2EEStore.setState({ ensureConversationSecretKey: vi.fn(async () => null) });
    await outbox().send({ conversationId: "c", text: "x", files: [], gif: null, parentMessageId: null });
    expect(outbox().entries[0]!.error).toMatch(/doesn't have the key/);
    expect(emit).not.toHaveBeenCalled();
  });

  it("never leaves a message stuck when the session or conversation is gone", async () => {
    useAuthStore.setState({ token: null });
    await outbox().send({ conversationId: "c", text: "x", files: [], gif: null, parentMessageId: null });
    expect(outbox().entries[0]).toMatchObject({ status: "failed", error: "You're signed out. Sign in again to send." });

    outbox().reset();
    useAuthStore.setState({ token: "t" });
    await outbox().send({ conversationId: "gone", text: "x", files: [], gif: null, parentMessageId: null });
    expect(outbox().entries[0]).toMatchObject({ status: "failed", error: "This conversation isn't available anymore." });
  });

  it("uploads files first and sends them as media with a GIF after them", async () => {
    const file = new File([new TextEncoder().encode("picture bytes")], "cat.png", { type: "image/png" });
    await outbox().send({ conversationId: "c", text: "", files: [file], gif: { kind: "gif_link", url: "https://g/1.gif" }, parentMessageId: null });
    const payload = lastPayload();
    expect(payload).toMatchObject({ type: "media", mediaIds: ["media-1"] });
    const envelope = JSON.parse(await decryptMessage(payload.ciphertext, payload.nonce, key));
    expect(envelope.attachments.map((a: { kind: string }) => a.kind)).toEqual(["image", "gif_link"]);
    expect(outbox().entries[0]!.files).toEqual([]);
  });

  it("keeps the files when an upload fails so retry can redo it", async () => {
    requestMediaUploadUrl.mockRejectedValueOnce(new Error("quota"));
    const file = new File(["x"], "a.txt", { type: "text/plain" });
    await outbox().send({ conversationId: "c", text: "", files: [file], gif: null, parentMessageId: null });
    expect(outbox().entries[0]).toMatchObject({ status: "failed", error: "quota" });
    expect(outbox().entries[0]!.files).toHaveLength(1);
    await outbox().retry(outbox().entries[0]!.localId);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("encryptAndUpload", () => {
  it("uploads only ciphertext that the wrapped file key decrypts back to the original", async () => {
    const original = new TextEncoder().encode("top secret pdf");
    await encryptAndUpload({ file: new File([original], "doc.pdf", { type: "application/pdf" }), conversationId: "c", conversationKey: key, token: "t" }).then(
      async (attachment) => {
        expect(attachment).toMatchObject({ kind: "file", mediaId: "media-1", name: "doc.pdf", mimeType: "application/pdf", size: original.length });
        const blob = uploadEncryptedBlob.mock.calls[0]![1] as Blob;
        const uploaded = new Uint8Array(await blob.arrayBuffer());
        expect(new TextDecoder().decode(uploaded)).not.toContain("top secret");
        expect(await sha256Base64(uploaded)).toBe(attachment.encryptedSha256);
        expect(requestMediaUploadUrl.mock.calls[0]![0]).toMatchObject({ sha256: attachment.encryptedSha256, contentLength: uploaded.length });

        const fileKey = await decryptMessage(attachment.fileKeyCiphertext, attachment.fileKeyNonce, key);
        expect(new TextDecoder().decode(await decryptChunkedBytes(uploaded, fileKey))).toBe("top secret pdf");
      }
    );
  });
});
