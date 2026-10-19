import { describe, expect, it } from "vitest";
import { tokenizeMessageText, mentionsUser } from "../MessageText";
import { GROUP_WINDOW_MS, buildTimeline, dayLabel } from "../timeline";

const at = (iso: string) => new Date(iso).getTime();
const msg = (id: string, iso: string, senderId = "ada") => ({ id, senderId, sender: senderId, cipherText: "x", createdAt: at(iso) });
const kinds = (items: ReturnType<typeof buildTimeline>) =>
  items.map((i) => (i.kind === "message" ? `${i.key}${i.startsGroup ? "*" : ""}` : i.kind));

describe("buildTimeline", () => {
  it("adds a separator per day and groups a sender's messages within the window", () => {
    const items = buildTimeline([
      msg("1", "2026-10-17T10:00:00"),
      msg("2", "2026-10-17T10:02:00"),
      msg("3", "2026-10-17T10:02:30", "bob"),
      msg("4", "2026-10-17T10:03:00", "bob"),
      msg("5", "2026-10-18T09:00:00", "bob")
    ]);
    expect(kinds(items)).toEqual(["day", "1*", "2", "3*", "4", "day", "5*"]);
  });

  it("starts a new group after the time window", () => {
    const base = at("2026-10-17T10:00:00");
    const items = buildTimeline([
      { ...msg("1", "2026-10-17T10:00:00") },
      { ...msg("2", "2026-10-17T10:00:00"), createdAt: base + GROUP_WINDOW_MS + 1 }
    ]);
    expect(kinds(items)).toEqual(["day", "1*", "2*"]);
  });

  it("puts the unread marker before the first unread message and starts a group there", () => {
    const items = buildTimeline(
      [msg("1", "2026-10-17T10:00:00"), msg("2", "2026-10-17T10:01:00"), msg("3", "2026-10-17T10:01:30")],
      { unreadCount: 2, myUserId: "me" }
    );
    expect(kinds(items)).toEqual(["day", "1*", "unread", "2*", "3"]);
    expect(items.find((i) => i.kind === "unread")).toMatchObject({ count: 2 });
  });

  it("caps the unread count and skips the marker when the first unread is mine", () => {
    expect(kinds(buildTimeline([msg("1", "2026-10-17T10:00:00")], { unreadCount: 9 }))).toEqual(["day", "unread", "1*"]);
    expect(kinds(buildTimeline([msg("1", "2026-10-17T10:00:00", "me")], { unreadCount: 1, myUserId: "me" }))).toEqual(["day", "1*"]);
  });
});

describe("dayLabel", () => {
  const now = at("2026-10-18T15:00:00");
  it("says Today, Yesterday, a weekday, then a date", () => {
    expect(dayLabel(at("2026-10-18T01:00:00"), now)).toBe("Today");
    expect(dayLabel(at("2026-10-17T23:59:00"), now)).toBe("Yesterday");
    expect(dayLabel(at("2026-10-14T12:00:00"), now)).toMatch(/Wednesday/);
    expect(dayLabel(at("2026-09-01T12:00:00"), now)).toMatch(/September/);
    expect(dayLabel(at("2025-09-01T12:00:00"), now)).toMatch(/2025/);
  });
});

describe("tokenizeMessageText", () => {
  it("finds https links, trimming sentence punctuation", () => {
    expect(tokenizeMessageText("see https://example.com/a?b=1. ok")).toEqual([
      { kind: "text", value: "see " },
      { kind: "link", value: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { kind: "text", value: ". ok" }
    ]);
  });

  it("leaves http and javascript URLs as text", () => {
    expect(tokenizeMessageText("http://x.com javascript:alert(1)").every((p) => p.kind === "text")).toBe(true);
  });

  it("finds mentions but not email addresses", () => {
    expect(tokenizeMessageText("hi @ada and a@b.com").filter((p) => p.kind === "mention")).toEqual([
      { kind: "mention", value: "@ada", username: "ada" }
    ]);
  });

  it("detects mentions of a user case-insensitively", () => {
    expect(mentionsUser("hey @Ada!", "ada")).toBe(true);
    expect(mentionsUser("hey @adam", "ada")).toBe(false);
    expect(mentionsUser("hey", undefined)).toBe(false);
  });
});
