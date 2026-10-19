import { describe, expect, it } from "vitest";
import {
  buildConversationLists,
  conversationTitle,
  formatListTime,
  lastActivityAt,
  matchesFilter,
  previewText,
  totalUnread
} from "../selectors";
import { ME, dm, group, message } from "./fixtures";

describe("conversationTitle", () => {
  it("prefers a custom name", () => {
    expect(conversationTitle(dm("c", "ada", { name: "  Project  " }), ME.id)).toBe("Project");
  });

  it("uses the DM partner's display name, then username", () => {
    const conv = dm("c", "ada");
    expect(conversationTitle(conv, ME.id)).toBe("ada");
    expect(conversationTitle(conv, ME.id, { ada: { id: "ada", username: "ada", displayName: "Ada L." } })).toBe("Ada L.");
  });

  it("lists group members, collapsing beyond two", () => {
    expect(conversationTitle(group("g", ["ada", "grace"]), ME.id)).toBe("ada, grace");
    expect(conversationTitle(group("g", ["ada", "grace", "linus", "margaret"]), ME.id)).toBe("ada, grace +2");
    expect(conversationTitle(group("g", []), ME.id)).toBe("Empty group");
  });
});

describe("buildConversationLists", () => {
  const a = dm("a", "ada");
  const b = dm("b", "bob");
  const g = group("g", ["ada", "bob"]);
  const old = dm("old", "olga");
  const messages = { a: [message("1", Date.parse("2026-02-01"))], g: [message("2", Date.parse("2026-03-01"))] };

  it("puts pinned first, then most recent, and leaves archived out", () => {
    const lists = buildConversationLists({ conversations: [a, b, g, old], messagesByConversation: messages, pinnedIds: ["b"], archivedIds: ["old"] });
    expect(lists.active.map((c) => c.id)).toEqual(["b", "g", "a"]);
    expect(lists.dms.map((c) => c.id)).toEqual(["b", "a"]);
    expect(lists.groups.map((c) => c.id)).toEqual(["g"]);
    expect(lists.archived.map((c) => c.id)).toEqual(["old"]);
  });

  it("falls back to creation time without messages", () => {
    const newer = dm("n", "nina", { createdAt: "2026-06-01T00:00:00.000Z" });
    expect(lastActivityAt(newer, undefined)).toBe(Date.parse("2026-06-01T00:00:00.000Z"));
    const lists = buildConversationLists({ conversations: [a, newer], messagesByConversation: messages, pinnedIds: [], archivedIds: [] });
    expect(lists.active[0]!.id).toBe("n");
  });
});

describe("matchesFilter", () => {
  it("matches title or member username, case-insensitively", () => {
    const g = group("g", ["ada", "grace"], { name: "Book club" });
    expect(matchesFilter(g, "Book club", "BOOK")).toBe(true);
    expect(matchesFilter(g, "Book club", "grac")).toBe(true);
    expect(matchesFilter(g, "Book club", "zed")).toBe(false);
    expect(matchesFilter(g, "Book club", "  ")).toBe(true);
  });
});

describe("formatListTime", () => {
  const now = Date.parse("2026-10-18T12:00:00");
  it.each([
    [now - 10_000, "now"],
    [now - 5 * 60_000, "5m"],
    [now - 3 * 3_600_000, "3h"]
  ])("%s → %s", (ts, expected) => {
    expect(formatListTime(ts, now)).toBe(expected);
  });

  it("uses a weekday within a week and a date after that", () => {
    expect(formatListTime(now - 3 * 86_400_000, now)).toMatch(/^[A-Za-z]{2,4}\.?$/);
    expect(formatListTime(Date.parse("2026-01-05T12:00:00"), now)).toMatch(/Jan/);
    expect(formatListTime(Date.parse("2024-01-05T12:00:00"), now)).toMatch(/24/);
  });
});

describe("previewText", () => {
  it("names the sender without decrypting", () => {
    const conv = dm("c", "ada");
    expect(previewText(conv, [message("1", 1, ME.id)], ME.id)).toBe("You sent a message");
    expect(previewText(conv, [message("1", 1, "ada", { mediaIds: ["m"] })], ME.id)).toBe("Sent an attachment");
    const g = group("g", ["ada", "bob"]);
    expect(previewText(g, [message("1", 1, "ada")], ME.id)).toBe("ada sent a message");
    expect(previewText(g, [message("1", 1, "ada")], ME.id, { ada: { id: "ada", username: "ada", displayName: "Ada L." } })).toBe(
      "Ada L. sent a message"
    );
    expect(previewText(conv, [], ME.id)).toBe("No messages yet");
    expect(previewText(group("g", ["a", "b"]), undefined, ME.id)).toBe("3 members");
  });
});

it("totals unread by type", () => {
  const convs = [dm("a", "ada"), group("g", ["x"])];
  expect(totalUnread(convs, { a: 2, g: 3 })).toBe(5);
  expect(totalUnread(convs, { a: 2, g: 3 }, "dm")).toBe(2);
  expect(totalUnread(convs, {}, "group")).toBe(0);
});
