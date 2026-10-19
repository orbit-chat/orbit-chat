// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ME, dm, group } from "./fixtures";

const getConversations = vi.fn();
const getMessages = vi.fn();
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  getConversations: (...args: unknown[]) => getConversations(...args),
  getMessages: (...args: unknown[]) => getMessages(...args),
  getUser: vi.fn(async (id: string) => ({ id, username: id }))
}));

const { useConversationSync } = await import("../useConversationSync");
const { useConversationsStore } = await import("../conversationsStore");
const { useAuthStore } = await import("../../../stores/authStore");
const { useSocketStore } = await import("../../../stores/socketStore");
const { useMessagesStore } = await import("../../../stores/messagesStore");
const { useNavigationStore } = await import("../../../stores/navigationStore");
const { usePrefsStore } = await import("../../../stores/prefsStore");
const { useChatLockStore } = await import("../../../stores/chatLockStore");
const { useE2EEStore } = await import("../../../stores/e2eeStore");

/** Minimal stand-in for a socket.io client: records handlers so tests can fire server events. */
class FakeSocket {
  handlers = new Map<string, Set<(...args: any[]) => void>>();
  on(event: string, handler: (...args: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: (...args: any[]) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  fire(event: string, payload: unknown) {
    act(() => this.handlers.get(event)?.forEach((h) => h(payload)));
  }
}

let socket: FakeSocket;
const ensureConversationSecretKey = vi.fn(async () => "key");

beforeEach(() => {
  socket = new FakeSocket();
  getConversations.mockReset().mockResolvedValue([dm("a", "ada"), group("g", ["ada", "bob"])]);
  getMessages.mockReset().mockResolvedValue([]);
  ensureConversationSecretKey.mockClear();
  useConversationsStore.getState().reset();
  useAuthStore.setState({ user: ME, token: "t" });
  useSocketStore.setState({ socket: socket as never, connectionState: "connected" });
  useMessagesStore.setState({ byConversation: {}, unreadCountByConversation: {}, activeConversationId: null });
  useNavigationStore.getState().reset();
  usePrefsStore.setState({ userId: ME.id, byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate(ME.id);
  useChatLockStore.setState({ unlocked: {} });
  useE2EEStore.setState({ ensureConversationSecretKey, getConversationKeyVersion: () => 1 });
});

async function mount() {
  const hook = renderHook(() => useConversationSync());
  await waitFor(() => expect(useConversationsStore.getState().status).toBe("ready"));
  return hook;
}

describe("useConversationSync", () => {
  it("loads conversations and backfills history as read", async () => {
    getMessages.mockImplementation(async (conversationId: string) =>
      conversationId === "a"
        ? [{ id: "m1", conversationId: "a", senderId: "ada", parentMessageId: null, ciphertext: "c", nonce: "n", keyVersion: 1, type: "text", expiresAt: null, maxViews: null, currentViews: 0, createdAt: "2026-01-01T00:00:00Z", sender: { id: "ada", username: "ada" } }]
        : []
    );
    await mount();
    await waitFor(() => expect(useMessagesStore.getState().byConversation.a).toHaveLength(1));
    expect(useMessagesStore.getState().unreadCountByConversation.a ?? 0).toBe(0);
  });

  it("doesn't backfill locked passcode chats", async () => {
    getConversations.mockResolvedValue([dm("a", "ada"), dm("locked", "bob", { passcodeEnabled: true })]);
    await mount();
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith("a", "t"));
    expect(getMessages).not.toHaveBeenCalledWith("locked", "t");
  });

  it("applies created, updated and member events", async () => {
    await mount();
    socket.fire("conversation_created", { conversation: dm("n", "nina"), passcode: "4321" });
    expect(useConversationsStore.getState().conversations[0]!.id).toBe("n");
    expect(useConversationsStore.getState().pendingPasscodes.n).toEqual({ passcode: "4321", label: "nina" });

    socket.fire("chat_settings_updated", { conversation: group("g", ["ada", "bob"], { name: "Renamed" }) });
    expect(useConversationsStore.getState().conversations.find((c) => c.id === "g")!.name).toBe("Renamed");

    socket.fire("member_left", { conversationId: "g", userId: "bob" });
    expect(useConversationsStore.getState().conversations.find((c) => c.id === "g")!.members.map((m) => m.userId)).toEqual(["me", "ada"]);
    expect(ensureConversationSecretKey).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
  });

  it("drops a deleted conversation from the list, the route and prefs", async () => {
    await mount();
    act(() => {
      usePrefsStore.getState().togglePinned("a");
      useNavigationStore.getState().openConversation({ id: "a", type: "dm" });
    });
    socket.fire("conversation_deleted", { conversationId: "a" });

    expect(useConversationsStore.getState().conversations.map((c) => c.id)).toEqual(["g"]);
    expect(useNavigationStore.getState().route).toEqual({ page: "dm", conversationId: null });
    expect(usePrefsStore.getState().byUser[ME.id]!.pinnedConversationIds).toEqual([]);
  });

  it("reloads when a message arrives for an unknown conversation", async () => {
    await mount();
    getConversations.mockResolvedValue([dm("a", "ada"), group("g", ["ada", "bob"]), dm("z", "zed")]);
    socket.fire("new_message", { conversationId: "z" });
    await waitFor(() => expect(useConversationsStore.getState().conversations.map((c) => c.id)).toContain("z"));
  });

  it("marks the open conversation active and locks the previous one on leave", async () => {
    const onLeave = vi.spyOn(useChatLockStore.getState(), "onLeave");
    useChatLockStore.setState({ onLeave });
    useMessagesStore.setState({ unreadCountByConversation: { a: 3 } });
    await mount();

    act(() => useNavigationStore.getState().openConversation({ id: "a", type: "dm" }));
    expect(useMessagesStore.getState().activeConversationId).toBe("a");
    expect(useMessagesStore.getState().unreadCountByConversation.a).toBe(0);

    act(() => useNavigationStore.getState().goToPage("friends"));
    expect(onLeave).toHaveBeenCalledWith("a");
    expect(useMessagesStore.getState().activeConversationId).toBeNull();
  });

  it("reloads after reconnecting", async () => {
    await mount();
    expect(getConversations).toHaveBeenCalledTimes(1);
    act(() => useSocketStore.setState({ connectionState: "disconnected" }));
    act(() => useSocketStore.setState({ connectionState: "connected" }));
    await waitFor(() => expect(getConversations).toHaveBeenCalledTimes(2));
  });
});
