// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { encryptMessage, generateSecretKey } from "../../../lib/crypto";
import { DEFAULT_NOTIFICATIONS, usePrefsStore } from "../../../stores/prefsStore";
import { useAuthStore } from "../../../stores/authStore";
import { useSocketStore } from "../../../stores/socketStore";
import { useNavigationStore } from "../../../stores/navigationStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { useE2EEStore } from "../../../stores/e2eeStore";
import { useProfilesStore } from "../../../stores/profilesStore";
import { useConversationsStore } from "../../conversations/conversationsStore";
import { useDecryptedStore } from "../../chat/decryptedStore";
import { dm, group } from "../../conversations/__tests__/fixtures";
import { notificationContent, shouldNotify, windowTitle } from "../notificationRules";
import { useNotifications } from "../useNotifications";
import { NotificationsSection } from "../../settings/NotificationsSection";

const env = (text: string) => ({ text, attachments: [] });
const msg = { id: "m", conversationId: "c", senderId: "ada", sender: "ada" };
const base = { message: msg, myUserId: "me", myUsername: "me", prefs: DEFAULT_NOTIFICATIONS, muted: false, windowFocused: false, openConversationId: null, envelope: null };

describe("shouldNotify", () => {
  it("skips my own messages, muted chats, 'off', and the chat I'm looking at", () => {
    expect(shouldNotify(base)).toBe(true);
    expect(shouldNotify({ ...base, message: { ...msg, senderId: "me" } })).toBe(false);
    expect(shouldNotify({ ...base, muted: true })).toBe(false);
    expect(shouldNotify({ ...base, prefs: { ...DEFAULT_NOTIFICATIONS, mode: "off" } })).toBe(false);
    expect(shouldNotify({ ...base, windowFocused: true, openConversationId: "c" })).toBe(false);
    expect(shouldNotify({ ...base, windowFocused: false, openConversationId: "c" })).toBe(true);
    expect(shouldNotify({ ...base, windowFocused: true, openConversationId: "other" })).toBe(true);
  });

  it("only notifies for @mentions in mentions mode", () => {
    const mentions = { ...base, prefs: { ...DEFAULT_NOTIFICATIONS, mode: "mentions" as const } };
    expect(shouldNotify({ ...mentions, envelope: env("hey @me") })).toBe(true);
    expect(shouldNotify({ ...mentions, envelope: env("hey everyone") })).toBe(false);
    expect(shouldNotify({ ...mentions, envelope: null })).toBe(false);
  });
});

describe("notificationContent", () => {
  const params = { message: msg, conversation: dm("c", "ada"), senderName: "Ada", conversationTitle: "Ada", prefs: DEFAULT_NOTIFICATIONS, envelope: env("secret plans") };

  it("hides message text unless previews are on", () => {
    expect(notificationContent(params)).toEqual({ title: "Ada", body: "New message" });
    expect(notificationContent({ ...params, prefs: { ...DEFAULT_NOTIFICATIONS, showPreview: true } }).body).toBe("secret plans");
  });

  it("never shows text for passcode chats, and names the group", () => {
    const preview = { ...DEFAULT_NOTIFICATIONS, showPreview: true };
    expect(notificationContent({ ...params, prefs: preview, conversation: dm("c", "ada", { passcodeEnabled: true }) }).body).toBe("New message in a locked chat");
    expect(notificationContent({ ...params, conversation: group("c", ["ada"]), conversationTitle: "Crew" }).title).toBe("Ada in Crew");
  });

  it("describes attachments and truncates long text", () => {
    const preview = { ...DEFAULT_NOTIFICATIONS, showPreview: true };
    expect(notificationContent({ ...params, prefs: preview, envelope: { text: "", attachments: [{ kind: "gif_link", url: "https://g" }] } }).body).toBe("Sent a GIF");
    expect(notificationContent({ ...params, prefs: preview, envelope: env("x".repeat(200)) }).body).toHaveLength(140);
  });
});

it("windowTitle counts unread outside muted chats", () => {
  expect(windowTitle({}, [])).toBe("Orbit Chat");
  expect(windowTitle({ a: 2, b: 3 }, [])).toBe("(5) Orbit Chat");
  expect(windowTitle({ a: 2, b: 3 }, ["b"])).toBe("(2) Orbit Chat");
  expect(windowTitle({ a: 500 }, [])).toBe("(99+) Orbit Chat");
});

describe("useNotifications", () => {
  const shown: Array<{ title: string; body: string; instance: { onclick: null | (() => void); close: () => void } }> = [];
  class FakeNotification {
    static permission = "granted";
    onclick: null | (() => void) = null;
    close = vi.fn();
    constructor(title: string, options: { body: string }) {
      shown.push({ title, body: options.body, instance: this });
    }
  }
  const handlers = new Map<string, (data: unknown) => void>();
  let key: string;

  beforeEach(async () => {
    shown.length = 0;
    handlers.clear();
    vi.stubGlobal("Notification", FakeNotification);
    key = await generateSecretKey();
    useDecryptedStore.getState().reset();
    useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
    useSocketStore.setState({ socket: { on: (e: string, h: (d: unknown) => void) => handlers.set(e, h), off: vi.fn() } as never });
    usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
    usePrefsStore.getState().activate("me");
    usePrefsStore.getState().setNotifications({ sound: false });
    useNavigationStore.getState().reset();
    useMessagesStore.setState({ unreadCountByConversation: {} });
    useProfilesStore.setState({ byId: { ada: { id: "ada", username: "ada", displayName: "Ada Lovelace" } } });
    useConversationsStore.setState({ conversations: [dm("c", "ada")] });
    useE2EEStore.setState({ secretKeyByConversationIdAndVersion: { c: { 1: key } }, secretKeyByConversationId: { c: key } });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function incoming(text: string) {
    const { cipherText, nonce } = await encryptMessage(JSON.stringify({ text }), key);
    await act(async () => handlers.get("new_message")!({ id: `m${Math.random()}`, conversationId: "c", senderId: "ada", sender: "ada", ciphertext: cipherText, nonce, keyVersion: 1 }));
  }

  it("notifies without text by default, and clicking opens the chat", async () => {
    renderHook(() => useNotifications());
    await incoming("hi there");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: "Ada Lovelace", body: "New message" });
    act(() => shown[0]!.instance.onclick!());
    expect(useNavigationStore.getState().route).toEqual({ page: "dm", conversationId: "c" });
  });

  it("decrypts for previews and mentions, and respects mute", async () => {
    usePrefsStore.getState().setNotifications({ showPreview: true, mode: "mentions" });
    renderHook(() => useNotifications());
    await incoming("no mention here");
    expect(shown).toHaveLength(0);
    await incoming("ping @me");
    await waitFor(() => expect(shown.at(-1)?.body).toBe("ping @me"));

    act(() => usePrefsStore.getState().toggleMuted("c"));
    await incoming("@me again");
    expect(shown).toHaveLength(1);
  });

  it("puts the unread count in the window title", () => {
    renderHook(() => useNotifications());
    act(() => useMessagesStore.setState({ unreadCountByConversation: { c: 3 } }));
    expect(document.title).toBe("(3) Orbit Chat");
  });
});

describe("NotificationsSection", () => {
  beforeEach(() => {
    vi.stubGlobal("Notification", { permission: "granted" });
    useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
    usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
    usePrefsStore.getState().activate("me");
    useConversationsStore.setState({ conversations: [dm("c", "ada")] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("changes the mode and previews, and unmutes chats", async () => {
    const user = userEvent.setup();
    act(() => usePrefsStore.getState().toggleMuted("c"));
    render(<NotificationsSection />);
    await user.click(screen.getByRole("radio", { name: /Mentions only/ }));
    await user.click(screen.getByRole("switch", { name: "Show message text" }));
    expect(usePrefsStore.getState().byUser.me!.notifications).toMatchObject({ mode: "mentions", showPreview: true });

    await user.click(screen.getByRole("radio", { name: /Off/ }));
    expect(screen.getByRole("switch", { name: "Play a sound" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Unmute" }));
    expect(usePrefsStore.getState().byUser.me!.mutedConversationIds).toEqual([]);
  });
});
