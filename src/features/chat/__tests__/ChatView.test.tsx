// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { encryptMessage, generateSecretKey } from "../../../lib/crypto";
import { dm } from "../../conversations/__tests__/fixtures";

const getMessages = vi.fn(async () => []);
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  getMessages: (...args: unknown[]) => getMessages(...(args as []))
}));

const { ChatView } = await import("../ChatView");
const { TooltipProvider } = await import("../../../ui");
const { useConversationsStore } = await import("../../conversations/conversationsStore");
const { useAuthStore } = await import("../../../stores/authStore");
const { useMessagesStore } = await import("../../../stores/messagesStore");
const { useE2EEStore } = await import("../../../stores/e2eeStore");
const { useChatLockStore } = await import("../../../stores/chatLockStore");
const { useDecryptedStore } = await import("../decryptedStore");
const { useHistoryStore } = await import("../historyStore");
const { useSocketStore } = await import("../../../stores/socketStore");

const key = await generateSecretKey();
const now = Date.now();

// jsdom has no layout, so every element reports clientHeight 0 and the virtualizer would
// render nothing. Give elements a desktop-sized viewport for this file.
const realClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
const realClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});
afterAll(() => {
  if (realClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", realClientHeight);
  if (realClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", realClientWidth);
});

async function sealedMessage(id: string, senderId: string, text: string, minutesAgo: number, extra: Record<string, unknown> = {}) {
  const { cipherText, nonce } = await encryptMessage(JSON.stringify({ text }), key);
  return { id, senderId, sender: senderId, cipherText, nonce, keyVersion: 1, createdAt: now - minutesAgo * 60_000, ...extra };
}

const renderChat = () =>
  render(
    <TooltipProvider>
      <ChatView conversationId="c" />
    </TooltipProvider>
  );

beforeEach(async () => {
  getMessages.mockClear();
  useDecryptedStore.getState().reset();
  useHistoryStore.getState().reset();
  useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
  useSocketStore.setState({ socket: null, connectionState: "idle" });
  useConversationsStore.setState({ conversations: [dm("c", "ada")], status: "ready" });
  useE2EEStore.setState({
    secretKeyByConversationId: { c: key },
    secretKeyByConversationIdAndVersion: { c: { 1: key } },
    loadingByConversationId: {}
  });
  useChatLockStore.setState({ unlocked: {} });
  useMessagesStore.setState({
    byConversation: {
      c: [
        await sealedMessage("1", "ada", "hey there", 10),
        await sealedMessage("2", "ada", "check https://example.com.", 9),
        await sealedMessage("3", "me", "on it", 5),
        await sealedMessage("4", "ada", "thanks @me", 1, { parentMessageId: "3" })
      ]
    },
    unreadCountByConversation: { c: 1 },
    activeConversationId: null
  });
});

describe("ChatView", () => {
  it("decrypts and renders the conversation with header, links and a new-messages marker", async () => {
    renderChat();
    expect(screen.getByRole("heading", { name: "ada" })).toBeInTheDocument();
    expect(screen.getByText("Encrypted")).toBeInTheDocument();
    expect(await screen.findByText("hey there")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("separator", { name: "New messages" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Today" })).toBeInTheDocument();
    expect(getMessages).toHaveBeenCalledWith("c", "t");
  });

  it("highlights a message that mentions me and jumps to a replied-to message", async () => {
    const user = userEvent.setup();
    renderChat();
    const mention = await screen.findByText("@me");
    expect(mention.closest(".rounded-2xl")).toHaveClass("border-orbit-warning/40");

    const quote = await screen.findByRole("button", { name: /me\s*on it/ });
    await user.click(quote);
    await waitFor(() => expect(document.querySelector('[data-message-id="3"] .ring-2')).not.toBeNull());
  });

  it("shows a placeholder instead of content it can't decrypt", async () => {
    const other = await generateSecretKey();
    const { cipherText, nonce } = await encryptMessage("nope", other);
    useMessagesStore.setState({ byConversation: { c: [{ id: "x", senderId: "ada", sender: "ada", cipherText, nonce, keyVersion: 1, createdAt: now }] } });
    renderChat();
    expect(await screen.findByText("This message couldn't be decrypted on this device.")).toBeInTheDocument();
  });

  it("keeps a passcode chat locked and doesn't fetch its messages", () => {
    useConversationsStore.setState({ conversations: [dm("c", "ada", { passcodeEnabled: true })] });
    renderChat();
    expect(screen.getByRole("heading", { name: "ada is locked" })).toBeInTheDocument();
    expect(screen.queryByText("hey there")).not.toBeInTheDocument();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("says when the key isn't available", async () => {
    useE2EEStore.setState({ secretKeyByConversationId: {}, secretKeyByConversationIdAndVersion: {}, errorByConversationId: {} });
    renderChat();
    expect(screen.getByText("Encryption unavailable")).toBeInTheDocument();
    expect((await screen.findAllByText("Waiting for this conversation's key…")).length).toBeGreaterThan(0);
  });
});
