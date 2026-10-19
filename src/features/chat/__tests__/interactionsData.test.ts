// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSocketStore } from "../../../stores/socketStore";
import { useDraftsStore } from "../../composer/draftsStore";
import { useOutboxStore } from "../../composer/outboxStore";
import { useOutboxSync } from "../../composer/useOutboxSync";
import { useChatUiStore } from "../chatUiStore";
import { buildMessageActions, QUICK_REACTIONS, threadRootOf } from "../messageActions";
import { TYPING_EXPIRY_MS, usePresenceStore } from "../presenceStore";
import { excerpt, searchMessages } from "../searchMessages";
import { ERROR_ATTRIBUTION_MS, emitAction, errorLikelyFrom, markSeen, resetLastEmit, togglePin, toggleReaction } from "../socketActions";
import { typingLabel } from "../TypingIndicator";
import { REACTION_EMOJI_CATALOG } from "../../composer/emojiCatalog";

const emit = vi.fn();
const msg = (id: string, senderId: string, extra: Record<string, unknown> = {}) => ({ id, senderId, sender: senderId, cipherText: "x", createdAt: 1, ...extra });
const ok = (text: string) => ({ status: "ok" as const, envelope: { text, attachments: [] } });

beforeEach(() => {
  emit.mockReset();
  resetLastEmit();
  useSocketStore.setState({ socket: { emit } as never });
  usePresenceStore.getState().reset();
  useDraftsStore.getState().reset();
  useChatUiStore.getState().reset();
});
afterEach(() => vi.useRealTimers());

describe("socketActions", () => {
  it("emits the server's event names and payloads", () => {
    toggleReaction("c", "m", "👍");
    togglePin("c", "m");
    markSeen("c", "m");
    expect(emit.mock.calls).toEqual([
      ["toggle_reaction", { conversationId: "c", messageId: "m", emoji: "👍" }],
      ["toggle_message_pin", { conversationId: "c", messageId: "m" }],
      ["message_seen", { conversationId: "c", messageId: "m" }]
    ]);
  });

  it("reports offline and attributes errors only to the latest recent emit", () => {
    useSocketStore.setState({ socket: null });
    expect(emitAction("send_message", {})).toBe(false);
    expect(errorLikelyFrom("send_message")).toBe(false);

    useSocketStore.setState({ socket: { emit } as never });
    emitAction("send_message", {});
    expect(errorLikelyFrom("send_message")).toBe(true);
    expect(errorLikelyFrom("send_message", Date.now() + ERROR_ATTRIBUTION_MS + 1)).toBe(false);
    toggleReaction("c", "m", "👍");
    expect(errorLikelyFrom("send_message")).toBe(false);
  });

  it("keeps a reaction error from failing a pending message (outbox listener)", () => {
    const handlers = new Map<string, (data: unknown) => void>();
    useSocketStore.setState({ socket: { emit, on: (e: string, h: (d: unknown) => void) => handlers.set(e, h), off: vi.fn() } as never });
    const failOldestSending = vi.fn();
    useOutboxStore.setState({ failOldestSending });
    renderHook(() => useOutboxSync());

    emitAction("send_message", {});
    toggleReaction("c", "m", "🦄");
    handlers.get("error")!({ message: "Unsupported reaction emoji" });
    expect(failOldestSending).not.toHaveBeenCalled();

    emitAction("send_message", {});
    handlers.get("error")!({ message: "Not a member" });
    expect(failOldestSending).toHaveBeenCalledWith("Not a member");
  });

  it("only offers reactions the server accepts", () => {
    const allowed = new Set(REACTION_EMOJI_CATALOG.map((r) => r.emoji));
    expect(QUICK_REACTIONS.every((e) => allowed.has(e))).toBe(true);
  });
});

describe("presenceStore", () => {
  it("tracks typing, ignores duplicates and expires silent typists", () => {
    vi.useFakeTimers();
    const store = usePresenceStore.getState();
    store.startTyping("c", "ada");
    store.startTyping("c", "ada");
    store.startTyping("c", "bob");
    expect(usePresenceStore.getState().typingByConversation.c).toEqual(["ada", "bob"]);
    store.stopTyping("c", "bob");
    expect(usePresenceStore.getState().typingByConversation.c).toEqual(["ada"]);
    vi.advanceTimersByTime(TYPING_EXPIRY_MS + 1);
    expect(usePresenceStore.getState().typingByConversation.c).toBeUndefined();
  });

  it("restarts the expiry when typing continues", () => {
    vi.useFakeTimers();
    usePresenceStore.getState().startTyping("c", "ada");
    vi.advanceTimersByTime(TYPING_EXPIRY_MS - 100);
    usePresenceStore.getState().startTyping("c", "ada");
    vi.advanceTimersByTime(TYPING_EXPIRY_MS - 100);
    expect(usePresenceStore.getState().typingByConversation.c).toEqual(["ada"]);
  });

  it("records who has seen a message once each", () => {
    usePresenceStore.getState().markSeenBy("m", "ada");
    usePresenceStore.getState().markSeenBy("m", "ada");
    usePresenceStore.getState().markSeenBy("m", "bob");
    expect(usePresenceStore.getState().seenByMessage.m).toEqual(["ada", "bob"]);
  });

  it("labels who is typing", () => {
    expect(typingLabel([])).toBe("");
    expect(typingLabel(["Ada"])).toBe("Ada is typing");
    expect(typingLabel(["Ada", "Bob"])).toBe("Ada and Bob are typing");
    expect(typingLabel(["Ada", "Bob", "Cy"])).toBe("Several people are typing");
  });
});

describe("searchMessages", () => {
  const messages = [msg("1", "ada"), msg("2", "bob"), msg("3", "ada")];
  const decrypted = { "1": ok("trail at 8am"), "2": ok("bring water"), "3": ok("the TRAIL is muddy") };
  const senderName = (m: { senderId: string }) => (m.senderId === "ada" ? "Ada Lovelace" : "Bob");

  it("matches decrypted text case-insensitively, newest first", () => {
    expect(searchMessages({ messages, decrypted, query: "trail", senderName }).map((h) => h.message.id)).toEqual(["3", "1"]);
  });

  it("also matches the sender's name, and nothing for a blank query", () => {
    expect(searchMessages({ messages, decrypted, query: "bob", senderName }).map((h) => h.message.id)).toEqual(["2"]);
    expect(searchMessages({ messages, decrypted, query: "  ", senderName })).toEqual([]);
  });

  it("can't match messages it couldn't decrypt", () => {
    expect(searchMessages({ messages, decrypted: { "1": { status: "failed" } }, query: "trail", senderName })).toEqual([]);
  });

  it("excerpts around the match", () => {
    const text = `${"a".repeat(100)}needle${"b".repeat(100)}`;
    const parts = excerpt({ message: msg("x", "ada"), text, matchStart: 100, matchLength: 6 }, 10);
    expect(parts).toEqual({ before: `…${"a".repeat(10)}`, match: "needle", after: `${"b".repeat(10)}…` });
  });
});

describe("buildMessageActions", () => {
  const base = { conversationId: "c", senderName: "Ada", decrypted: ok("hi there") };

  it("offers mention only for others, copy only with text, and no thread link inside a thread", () => {
    const ids = (a: ReturnType<typeof buildMessageActions>) => a.map((x) => x.id);
    expect(ids(buildMessageActions({ ...base, message: msg("m", "ada"), mine: false }))).toEqual(["reply", "thread", "mention", "pin", "copy"]);
    expect(ids(buildMessageActions({ ...base, message: msg("m", "me"), mine: true }))).toEqual(["reply", "thread", "pin", "copy"]);
    expect(ids(buildMessageActions({ ...base, message: msg("m", "ada"), mine: false, inThread: true, decrypted: { status: "failed" } }))).toEqual(["reply", "mention", "pin"]);
  });

  it("wires reply, thread, mention and pin to the right places", () => {
    const actions = buildMessageActions({ ...base, message: msg("m2", "ada", { parentMessageId: "root" }), mine: false });
    const run = (id: string) => act(() => actions.find((a) => a.id === id)!.onSelect());

    run("reply");
    expect(useDraftsStore.getState().byConversation.c!.replyToId).toBe("m2");
    run("thread");
    expect(useChatUiStore.getState().threadRootByConversation.c).toBe("root");
    useDraftsStore.getState().setText("c", "hello");
    run("mention");
    run("mention");
    expect(useDraftsStore.getState().byConversation.c!.text).toBe("@ada hello");
    run("pin");
    expect(emit).toHaveBeenLastCalledWith("toggle_message_pin", { conversationId: "c", messageId: "m2" });

    const inThread = buildMessageActions({ ...base, message: msg("m3", "ada", { parentMessageId: "root" }), mine: false, inThread: true });
    act(() => inThread[0]!.onSelect());
    expect(useDraftsStore.getState().byConversation["c#root"]!.replyToId).toBe("m3");
  });

  it("threadRootOf uses the parent when there is one", () => {
    expect(threadRootOf(msg("a", "x"))).toBe("a");
    expect(threadRootOf(msg("b", "x", { parentMessageId: "a" }))).toBe("a");
  });
});
