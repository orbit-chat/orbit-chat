// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { encryptMessage, generateSecretKey } from "../../../lib/crypto";
import { group } from "../../conversations/__tests__/fixtures";

vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  getMessages: vi.fn(async () => [])
}));

const { ChatView } = await import("../ChatView");
const { TooltipProvider } = await import("../../../ui");
const { useConversationsStore } = await import("../../conversations/conversationsStore");
const { useAuthStore } = await import("../../../stores/authStore");
const { useMessagesStore } = await import("../../../stores/messagesStore");
const { useE2EEStore } = await import("../../../stores/e2eeStore");
const { useChatLockStore } = await import("../../../stores/chatLockStore");
const { useSocketStore } = await import("../../../stores/socketStore");
const { usePrefsStore } = await import("../../../stores/prefsStore");
const { useProfilesStore } = await import("../../../stores/profilesStore");
const { useDecryptedStore } = await import("../decryptedStore");
const { useHistoryStore } = await import("../historyStore");
const { useChatUiStore } = await import("../chatUiStore");
const { usePresenceStore } = await import("../presenceStore");
const { useDraftsStore } = await import("../../composer/draftsStore");
const { useOutboxStore } = await import("../../composer/outboxStore");

const key = await generateSecretKey();
const now = Date.now();
const emit = vi.fn();

const realClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const realClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
});
afterAll(() => {
  if (realClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", realClientHeight);
  if (realClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", realClientWidth);
});

async function sealed(id: string, senderId: string, text: string, minutesAgo: number, extra: Record<string, unknown> = {}) {
  const { cipherText, nonce } = await encryptMessage(JSON.stringify({ text }), key);
  return { id, senderId, sender: senderId, cipherText, nonce, keyVersion: 1, createdAt: now - minutesAgo * 60_000, ...extra };
}

function renderChat() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { enabled: false } } })}>
      <TooltipProvider>
        <ChatView conversationId="g" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
const emitted = (event: string) => emit.mock.calls.filter(([e]) => e === event).map(([, p]) => p);

beforeEach(async () => {
  emit.mockReset();
  useDecryptedStore.getState().reset();
  useHistoryStore.getState().reset();
  useChatUiStore.getState().reset();
  usePresenceStore.getState().reset();
  useDraftsStore.getState().reset();
  useOutboxStore.getState().reset();
  useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
  useSocketStore.setState({ socket: { emit, on: vi.fn(), off: vi.fn() } as never, connectionState: "connected" });
  usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate("me");
  useProfilesStore.setState({ byId: { ada: { id: "ada", username: "ada", displayName: "Ada Lovelace" }, bob: { id: "bob", username: "bob" } } });
  useConversationsStore.setState({ conversations: [group("g", ["ada", "bob"], { name: "Crew" })], status: "ready" });
  useE2EEStore.setState({
    secretKeyByConversationId: { g: key },
    secretKeyByConversationIdAndVersion: { g: { 1: key } },
    loadingByConversationId: {},
    ensureConversationSecretKey: vi.fn(async () => key)
  });
  useChatLockStore.setState({ unlocked: {} });
  useMessagesStore.setState({
    byConversation: {
      g: [
        await sealed("1", "ada", "Hike on Saturday?", 30, { isPinned: true, reactions: [{ emoji: "👍", count: 2, userIds: ["bob", "me"] }] }),
        await sealed("2", "bob", "Ridge trail works", 20, { parentMessageId: "1" }),
        await sealed("3", "me", "See you at 8", 10),
        await sealed("4", "ada", "Bring water", 5)
      ]
    },
    unreadCountByConversation: {},
    activeConversationId: null
  });
});

describe("message interactions", () => {
  it("shows the hover toolbar with CSS only: entering a row changes no state (regression)", async () => {
    renderChat();
    await screen.findByText("Bring water");
    const toolbar = row("4").querySelector<HTMLElement>("[data-message-toolbar]")!;
    const before = toolbar.className;
    expect(before).toContain("opacity-0");
    expect(before).toContain("group-hover/msg:opacity-100");
    fireEvent.mouseEnter(row("4"));
    fireEvent.mouseOver(row("4"));
    expect(toolbar.className).toBe(before);
  });

  it("renders the pinned popover outside the timeline and header (regression: hover leaked under it)", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(screen.getByRole("button", { name: "Pinned messages (1)" }));
    const popover = await screen.findByText("Pinned messages", { selector: "h2" });
    expect(screen.getByRole("log", { name: "Messages" })).not.toContainElement(popover);
    expect(screen.getByRole("heading", { name: "Crew" }).closest("header")).not.toContainElement(popover);

    await user.click(within(popover.closest("[role=dialog]") as HTMLElement).getByRole("button", { name: /Hike on Saturday/ }));
    await waitFor(() => expect(row("1").querySelector(".ring-2")).not.toBeNull());
  });

  it("reacts from the toolbar and toggles from a reaction chip", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("Bring water");
    await user.click(within(row("4")).getByRole("button", { name: "React 👍" }));
    await user.click(within(row("1")).getByRole("button", { name: /👍 2, including you/ }));
    expect(emitted("toggle_reaction")).toEqual([
      { conversationId: "g", messageId: "4", emoji: "👍" },
      { conversationId: "g", messageId: "1", emoji: "👍" }
    ]);
  });

  it("opens the same actions on right-click, including the thread", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("Bring water");
    fireEvent.contextMenu(within(row("2")).getByText("Ridge trail works"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(
      expect.arrayContaining(["Reply", "Open thread", "Mention bob", "Pin message", "Copy text"])
    );
    await user.click(within(menu).getByRole("menuitem", { name: "Open thread" }));

    const thread = await screen.findByRole("complementary", { name: "Thread" });
    expect(within(thread).getByText("Hike on Saturday?")).toBeInTheDocument();
    expect(within(thread).getByText("Ridge trail works")).toBeInTheDocument();
  });

  it("sends thread replies to the thread root with their own draft", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => {});
    useOutboxStore.setState({ send });
    act(() => useChatUiStore.getState().openThread("g", "1"));
    renderChat();
    const thread = await screen.findByRole("complementary", { name: "Thread" });
    const threadBox = within(thread).getByRole("combobox", { name: "Reply in thread" });
    await user.type(threadBox, "count me in{Enter}");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: "count me in", parentMessageId: "1" }));
    expect(screen.getByRole("combobox", { name: "Message Crew" })).toHaveValue("");

    await user.click(within(thread).getByRole("button", { name: "Close thread" }));
    expect(screen.queryByRole("complementary", { name: "Thread" })).not.toBeInTheDocument();
  });

  it("links a thread root to its replies", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(await within(row("1")).findByRole("button", { name: "1 reply" }));
    expect(useChatUiStore.getState().threadRootByConversation.g).toBe("1");
  });

  it("searches decrypted messages and jumps to a result", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(screen.getByRole("button", { name: "Search messages" }));
    await user.type(await screen.findByRole("textbox", { name: "Search this chat" }), "trail");
    const results = await screen.findByRole("list", { name: "Search results" });
    await waitFor(() => expect(within(results).getAllByRole("button")).toHaveLength(1));
    expect(within(results).getByText("trail", { selector: "mark" })).toBeInTheDocument();
    await user.click(within(results).getByRole("button"));
    await waitFor(() => expect(row("2").querySelector(".ring-2")).not.toBeNull());
  });

  it("shows who is typing and who has seen my latest message", async () => {
    renderChat();
    await screen.findByText("Bring water");
    act(() => {
      usePresenceStore.getState().startTyping("g", "ada");
      usePresenceStore.getState().markSeenBy("3", "bob");
    });
    expect(screen.getByText("Ada Lovelace is typing…")).toBeInTheDocument();
    expect(within(row("3")).getByText(/Seen by bob/)).toBeInTheDocument();
  });

  it("sends one read receipt, for the newest message from someone else", async () => {
    renderChat();
    await screen.findByText("Bring water");
    expect(emitted("message_seen")).toEqual([{ conversationId: "g", messageId: "4" }]);
  });

  it("sends no read receipts when they're turned off for the chat", async () => {
    act(() => usePrefsStore.getState().setChatRealtime("g", { readReceipts: false }));
    renderChat();
    await screen.findByText("Bring water");
    expect(emitted("message_seen")).toEqual([]);
  });
});
