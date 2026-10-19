// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptMessage, generateSecretKey } from "../../../lib/crypto";

const getMessages = vi.fn();
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  getMessages: (...args: unknown[]) => getMessages(...args)
}));

const { useDecryptedStore } = await import("../decryptedStore");
const { useHistoryStore, PAGE_SIZE } = await import("../historyStore");
const { useMessagesStore } = await import("../../../stores/messagesStore");
const { useAuthStore } = await import("../../../stores/authStore");

const key = await generateSecretKey();
const sealed = await encryptMessage(JSON.stringify({ text: "hello" }), key);
const encrypted = { id: "m1", cipherText: sealed.cipherText, nonce: sealed.nonce };

function serverMessage(i: number) {
  return {
    id: `s${i}`,
    conversationId: "c",
    senderId: "ada",
    parentMessageId: null,
    ciphertext: "x",
    nonce: "n",
    keyVersion: 1,
    type: "text",
    expiresAt: null,
    maxViews: null,
    currentViews: 0,
    createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
    sender: { id: "ada", username: "ada" }
  };
}

describe("decryptedStore", () => {
  beforeEach(() => useDecryptedStore.getState().reset());

  it("decrypts once even when asked concurrently", async () => {
    const [a, b] = await Promise.all([useDecryptedStore.getState().ensure(encrypted, key), useDecryptedStore.getState().ensure(encrypted, key)]);
    expect(a).toEqual({ status: "ok", envelope: { text: "hello", attachments: [] } });
    expect(b).toBe(a);
    expect(useDecryptedStore.getState().byMessageId.m1).toBe(a);
  });

  it("records failures and retries them with a different key", async () => {
    expect(await useDecryptedStore.getState().ensure(encrypted, await generateSecretKey())).toEqual({ status: "failed" });
    expect((await useDecryptedStore.getState().ensure(encrypted, key)).status).toBe("ok");
    expect((await useDecryptedStore.getState().ensure({ ...encrypted, id: "m2", nonce: undefined }, key)).status).toBe("failed");
  });

  it("forgets plaintext on reset and ignores work that finishes afterwards", async () => {
    const pending = useDecryptedStore.getState().ensure(encrypted, key);
    useDecryptedStore.getState().reset();
    await pending;
    expect(useDecryptedStore.getState().byMessageId).toEqual({});
  });
});

describe("historyStore", () => {
  beforeEach(() => {
    getMessages.mockReset();
    useHistoryStore.getState().reset();
    useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
    useMessagesStore.setState({ byConversation: {}, unreadCountByConversation: {}, activeConversationId: null });
  });

  it("loads the newest page as read and knows whether older pages exist", async () => {
    getMessages.mockResolvedValue(Array.from({ length: PAGE_SIZE }, (_, i) => serverMessage(i + 10)));
    await useHistoryStore.getState().loadLatest("c");
    expect(useMessagesStore.getState().byConversation.c).toHaveLength(PAGE_SIZE);
    expect(useMessagesStore.getState().unreadCountByConversation.c ?? 0).toBe(0);
    expect(useHistoryStore.getState().byConversation.c).toMatchObject({ hasOlder: true, loadingLatest: false });
  });

  it("pages backwards from the oldest cached message until a short page", async () => {
    getMessages.mockResolvedValueOnce(Array.from({ length: PAGE_SIZE }, (_, i) => serverMessage(i + 10)));
    await useHistoryStore.getState().loadLatest("c");

    getMessages.mockResolvedValueOnce([serverMessage(1), serverMessage(2)]);
    await useHistoryStore.getState().loadOlder("c");
    expect(getMessages).toHaveBeenLastCalledWith("c", "t", "s10");
    expect(useMessagesStore.getState().byConversation.c![0]!.id).toBe("s1");
    expect(useHistoryStore.getState().byConversation.c!.hasOlder).toBe(false);

    await useHistoryStore.getState().loadOlder("c");
    expect(getMessages).toHaveBeenCalledTimes(2);
  });

  it("keeps the error for the UI", async () => {
    getMessages.mockRejectedValue(new Error("offline"));
    await useHistoryStore.getState().loadLatest("c");
    expect(useHistoryStore.getState().byConversation.c).toMatchObject({ error: "offline", loadingLatest: false });
  });
});
