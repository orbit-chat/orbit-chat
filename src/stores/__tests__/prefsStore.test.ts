// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHAT_REALTIME, LEGACY_KEYS, PREFS_STORAGE_KEY, usePrefsStore } from "../prefsStore";

const prefs = () => usePrefsStore.getState();
const active = () => prefs().byUser[prefs().userId!]!;

describe("prefsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    usePrefsStore.setState({ userId: null, byUser: {}, legacyImported: false });
  });

  it("imports the old UI's keys for the first account only", () => {
    localStorage.setItem(LEGACY_KEYS.archived, JSON.stringify(["a1"]));
    localStorage.setItem(LEGACY_KEYS.pinned, JSON.stringify(["p1", 7]));
    localStorage.setItem(LEGACY_KEYS.chatRealtime, JSON.stringify({ c1: { readReceipts: false } }));
    localStorage.setItem(LEGACY_KEYS.recentEmojis, JSON.stringify(["🔥", "👍"]));

    prefs().activate("alice");
    expect(active()).toEqual({
      archivedConversationIds: ["a1"],
      pinnedConversationIds: ["p1"],
      chatRealtime: { c1: { readReceipts: false, typingIndicators: true } },
      recentEmojis: ["🔥", "👍"]
    });

    prefs().activate("bob");
    expect(active().archivedConversationIds).toEqual([]);
  });

  it("survives malformed legacy data", () => {
    localStorage.setItem(LEGACY_KEYS.archived, "{not json");
    localStorage.setItem(LEGACY_KEYS.chatRealtime, JSON.stringify(["wrong shape"]));
    prefs().activate("alice");
    expect(active().archivedConversationIds).toEqual([]);
    expect(active().chatRealtime).toEqual({});
  });

  it("keeps each account's prefs separate", () => {
    prefs().activate("alice");
    prefs().togglePinned("c1");
    prefs().activate("bob");
    expect(active().pinnedConversationIds).toEqual([]);
    prefs().activate("alice");
    expect(active().pinnedConversationIds).toEqual(["c1"]);
  });

  it("does nothing while signed out", () => {
    prefs().togglePinned("c1");
    expect(prefs().byUser).toEqual({});
  });

  it("toggles archive and pin membership", () => {
    prefs().activate("alice");
    prefs().toggleArchived("c1");
    prefs().toggleArchived("c2");
    prefs().toggleArchived("c1");
    expect(active().archivedConversationIds).toEqual(["c2"]);
  });

  it("merges realtime preference patches over the defaults", () => {
    prefs().activate("alice");
    prefs().setChatRealtime("c1", { typingIndicators: false });
    expect(active().chatRealtime.c1).toEqual({ ...DEFAULT_CHAT_REALTIME, typingIndicators: false });
  });

  it("keeps recent emojis unique, newest first, capped at 16", () => {
    prefs().activate("alice");
    for (let i = 0; i < 20; i++) prefs().pushRecentEmoji(String(i));
    prefs().pushRecentEmoji("10");
    expect(active().recentEmojis).toHaveLength(16);
    expect(active().recentEmojis[0]).toBe("10");
    expect(active().recentEmojis.filter((e) => e === "10")).toHaveLength(1);
  });

  it("forgets a conversation from every list", () => {
    prefs().activate("alice");
    prefs().togglePinned("c1");
    prefs().toggleArchived("c1");
    prefs().setChatRealtime("c1", { readReceipts: false });
    prefs().forgetConversation("c1");
    expect(active()).toMatchObject({ pinnedConversationIds: [], archivedConversationIds: [], chatRealtime: {} });
  });

  it("persists prefs but not the signed-in user", () => {
    prefs().activate("alice");
    prefs().togglePinned("c1");
    const saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY)!);
    expect(saved.state.byUser.alice.pinnedConversationIds).toEqual(["c1"]);
    expect(saved.state.userId).toBeUndefined();
  });
});
