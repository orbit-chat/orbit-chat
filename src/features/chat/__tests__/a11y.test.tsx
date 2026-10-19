// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { encryptMessage, generateSecretKey } from "../../../lib/crypto";
import { group } from "../../conversations/__tests__/fixtures";

vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  getMessages: vi.fn(async () => [])
}));

const { ChatView } = await import("../ChatView");
const { GifAttachment } = await import("../Attachments");
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

const key = await generateSecretKey();
const realClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeAll(() => Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 900 }));
afterAll(() => realClientHeight && Object.defineProperty(HTMLElement.prototype, "clientHeight", realClientHeight));

async function sealed(id: string, senderId: string, text: string, minutesAgo: number) {
  const { cipherText, nonce } = await encryptMessage(JSON.stringify({ text }), key);
  return { id, senderId, sender: senderId, cipherText, nonce, keyVersion: 1, createdAt: Date.now() - minutesAgo * 60_000 };
}

const renderChat = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { enabled: false } } })}>
      <TooltipProvider>
        <ChatView conversationId="g" />
      </TooltipProvider>
    </QueryClientProvider>
  );
const row = (id: string) => document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;

beforeEach(async () => {
  useDecryptedStore.getState().reset();
  useHistoryStore.getState().reset();
  useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
  useSocketStore.setState({ socket: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as never, connectionState: "connected" });
  usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate("me");
  useProfilesStore.setState({ byId: { ada: { id: "ada", username: "ada", displayName: "Ada Lovelace" } } });
  useConversationsStore.setState({ conversations: [group("g", ["ada"], { name: "Crew" })], status: "ready" });
  useE2EEStore.setState({ secretKeyByConversationId: { g: key }, secretKeyByConversationIdAndVersion: { g: { 1: key } } });
  useChatLockStore.setState({ unlocked: {} });
  useMessagesStore.setState({
    byConversation: { g: [await sealed("1", "ada", "first", 30), await sealed("2", "me", "second", 20), await sealed("3", "ada", "third", 10)] },
    unreadCountByConversation: {},
    activeConversationId: null
  });
});

describe("timeline keyboard access", () => {
  it("keeps one message in the tab order and moves with the arrow keys", async () => {
    const user = userEvent.setup();
    renderChat();
    await screen.findByText("third");
    expect(row("3")).toHaveAttribute("tabindex", "0");
    expect(row("1")).toHaveAttribute("tabindex", "-1");
    expect(within(row("3")).getByRole("button", { name: "React 👍" })).toHaveAttribute("tabindex", "-1");

    row("3").focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(row("2")).toHaveFocus());
    expect(row("2")).toHaveAttribute("tabindex", "0");
    await user.keyboard("{Home}");
    await waitFor(() => expect(row("1")).toHaveFocus());
    await user.keyboard("{End}");
    await waitFor(() => expect(row("3")).toHaveFocus());

    await user.keyboard("{Escape}");
    expect(screen.getByRole("combobox", { name: "Message Crew" })).toHaveFocus();
  });

  it("announces new incoming messages without making the whole timeline live", async () => {
    renderChat();
    await screen.findByText("third");
    expect(screen.getByRole("log", { name: "Messages" })).toHaveAttribute("aria-live", "off");
    const incoming = await sealed("4", "ada", "fourth", 0);
    act(() => useMessagesStore.getState().upsertMessage("g", incoming));
    await waitFor(() => expect(screen.getByRole("status", { name: "" })).toBeTruthy());
    expect(document.querySelector(".sr-only[aria-live=polite]")).toHaveTextContent("New message from Ada Lovelace");
  });
});

describe("lightbox", () => {
  it("opens a GIF full-size and closes with Escape", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <GifAttachment attachment={{ kind: "gif_link", url: "https://media.giphy.com/x.gif", previewUrl: "https://media.giphy.com/x-small.gif", title: "party" }} />
      </TooltipProvider>
    );
    await user.click(screen.getByRole("button", { name: "View party" }));
    const dialog = await screen.findByRole("dialog", { name: "party" });
    expect(within(dialog).getByRole("img", { name: "party" })).toHaveAttribute("src", "https://media.giphy.com/x.gif");
    expect(within(dialog).getByRole("link", { name: "Open original" })).toHaveAttribute("target", "_blank");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
