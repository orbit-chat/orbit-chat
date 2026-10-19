import { describe, expect, it } from "vitest";
import { filterMentionCandidates, mentionAtCaret, replaceRange } from "../textEditing";
import { rejectReason } from "../encryptAttachment";

describe("mentionAtCaret", () => {
  it("finds the @word being typed", () => {
    expect(mentionAtCaret("hi @ad", 6)).toEqual({ start: 3, end: 6, query: "ad" });
    expect(mentionAtCaret("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("ignores emails, finished mentions and text after the caret", () => {
    expect(mentionAtCaret("mail a@b", 8)).toBeNull();
    expect(mentionAtCaret("hi @ada ", 8)).toBeNull();
    expect(mentionAtCaret("hi @ada there", 13)).toBeNull();
    expect(mentionAtCaret("hi @ada there", 7)).toEqual({ start: 3, end: 7, query: "ada" });
  });
});

it("replaceRange returns the new text and caret", () => {
  expect(replaceRange("hi @ad!", 3, 6, "@ada ")).toEqual({ text: "hi @ada !", caret: 8 });
});

describe("filterMentionCandidates", () => {
  const people = [
    { id: "1", username: "ada", displayName: "Ada Lovelace" },
    { id: "2", username: "adam", displayName: null },
    { id: "3", username: "grace", displayName: "Grace Hopper" },
    { id: "4", username: "hopper2", displayName: "Admiral" }
  ];

  it("ranks exact, then username prefix, then display-name words", () => {
    expect(filterMentionCandidates(people, "ada").map((p) => p.username)).toEqual(["ada", "adam"]);
    expect(filterMentionCandidates(people, "ad").map((p) => p.username)).toEqual(["ada", "adam", "hopper2"]);
    expect(filterMentionCandidates(people, "hop").map((p) => p.username)).toEqual(["hopper2", "grace"]);
    expect(filterMentionCandidates(people, "").length).toBe(4);
    expect(filterMentionCandidates(people, "", 2).length).toBe(2);
  });
});

describe("rejectReason", () => {
  const file = (name: string, type: string, size: number) => new File([new Uint8Array(Math.min(size, 4))], name, { type });
  it("blocks videos, empty files and files over 50 MB", () => {
    expect(rejectReason(file("clip.mp4", "video/mp4", 10))).toMatch(/videos can't be uploaded/);
    expect(rejectReason(new File([], "empty.txt", { type: "text/plain" }))).toMatch(/empty/);
    const big = file("big.zip", "application/zip", 4);
    Object.defineProperty(big, "size", { value: 51 * 1024 * 1024 });
    expect(rejectReason(big)).toMatch(/50 MB/);
    expect(rejectReason(file("ok.png", "image/png", 4))).toBeNull();
    expect(rejectReason(file("notes.pdf", "application/pdf", 4))).toBeNull();
  });
});
