import { describe, expect, it } from "vitest";
import { PROFILE_LIMITS, formToUpdate, localTimeIn, profileSchema, profileToForm } from "../profileSchema";
import { parseCodes } from "../../settings/PrivacySection";

const valid = profileToForm(undefined);

describe("profileSchema", () => {
  it("accepts an empty profile", () => {
    expect(profileSchema.safeParse(valid).success).toBe(true);
  });

  it("enforces the server's length limits", () => {
    const tooLong = profileSchema.safeParse({ ...valid, bio: "x".repeat(PROFILE_LIMITS.bio + 1) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe("Bio can be at most 280 characters.");
    expect(profileSchema.safeParse({ ...valid, displayName: "x".repeat(64) }).success).toBe(true);
  });

  it("only allows https links, and at most five", () => {
    const http = profileSchema.safeParse({ ...valid, links: [{ label: "site", url: "http://example.com" }] });
    expect(http.error?.issues[0]?.message).toBe("Links must start with https://");
    expect(profileSchema.safeParse({ ...valid, links: [{ label: "", url: "javascript:alert(1)" }] }).success).toBe(false);
    expect(profileSchema.safeParse({ ...valid, links: [{ label: "", url: "https://example.com" }] }).success).toBe(true);
    expect(profileSchema.safeParse({ ...valid, links: Array.from({ length: 6 }, () => ({ label: "", url: "" })) }).success).toBe(false);
  });
});

describe("formToUpdate", () => {
  it("turns blanks into null and drops empty link rows", () => {
    expect(
      formToUpdate({
        ...valid,
        displayName: "  Ada  ",
        presence: "dnd",
        links: [
          { label: " Site ", url: " https://ada.dev " },
          { label: "nothing", url: "  " }
        ]
      })
    ).toEqual({
      displayName: "Ada",
      pronouns: null,
      bio: null,
      statusEmoji: null,
      statusText: null,
      presence: "dnd",
      timezone: null,
      links: [{ label: "Site", url: "https://ada.dev" }]
    });
  });

  it("round-trips through profileToForm", () => {
    const profile = { id: "u", username: "ada", displayName: "Ada", links: [{ label: "x", url: "https://x.dev" }], presence: "idle" as const };
    expect(formToUpdate(profileToForm(profile))).toMatchObject({ displayName: "Ada", presence: "idle", links: [{ label: "x", url: "https://x.dev" }] });
  });
});

it("localTimeIn ignores invalid zones", () => {
  expect(localTimeIn("Not/AZone")).toBeNull();
  expect(localTimeIn(null)).toBeNull();
  expect(localTimeIn("UTC", new Date("2026-10-19T15:04:00Z"))).toMatch(/3:04|15:04/);
});

it("parseCodes splits on lines and commas", () => {
  expect(parseCodes(" aaaa-1111 \nbbbb-2222, cccc-3333\n\n")).toEqual(["aaaa-1111", "bbbb-2222", "cccc-3333"]);
});
