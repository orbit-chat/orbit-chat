// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { useSessionLifecycle } = await import("../useSessionLifecycle");
const { useAuthStore } = await import("../../stores/authStore");
const { useSocketStore } = await import("../../stores/socketStore");
const { useE2EEStore } = await import("../../stores/e2eeStore");
const { useDecryptedStore } = await import("../../features/chat/decryptedStore");
const { useOutboxStore } = await import("../../features/composer/outboxStore");
const { useProfilesStore } = await import("../../stores/profilesStore");
const { useMessagesStore } = await import("../../stores/messagesStore");

describe("useSessionLifecycle", () => {
  it("clears decrypted messages, pending sends and keys when the session ends without a sign-out", () => {
    useSocketStore.setState({ connect: vi.fn(), disconnect: vi.fn() });
    useProfilesStore.setState({ fetchMe: vi.fn(async () => undefined) } as never);
    useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
    renderHook(() => useSessionLifecycle());

    useDecryptedStore.setState({ byMessageId: { m1: { status: "ok", envelope: { text: "secret", attachments: [] } } } });
    useOutboxStore.setState({
      entries: [
        { localId: "l1", messageId: "m-l1", conversationId: "c", createdAt: 0, parentMessageId: null, envelope: { text: "draft", attachments: [] }, files: [], status: "failed", error: null, payload: null, wrappedWithKeyVersion: null, keyRetries: 0 }
      ]
    });
    useE2EEStore.getState().setConversationSecretKeyVersion({ conversationId: "c", keyVersion: 1, secretKey: "k" });
    useMessagesStore.getState().upsertMessage("c", { id: "m1", senderId: "ada", sender: "ada", cipherText: "x", createdAt: 1 });

    // The refresh token expired: clearSession runs, but nobody called signOut().
    act(() => useAuthStore.getState().clearSession());

    expect(useDecryptedStore.getState().byMessageId).toEqual({});
    expect(useOutboxStore.getState().entries).toEqual([]);
    expect(useE2EEStore.getState().secretKeyByConversationIdAndVersion).toEqual({});
    expect(useMessagesStore.getState().byConversation).toEqual({});
  });
});
