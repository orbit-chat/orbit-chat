import { beforeEach, describe, expect, it } from "vitest";
import { useNavigationStore } from "../navigationStore";

const nav = () => useNavigationStore.getState();

describe("navigationStore", () => {
  beforeEach(() => {
    nav().reset();
  });

  describe("settings is a route (regression: settings had to be closed with its Close button)", () => {
    it("leaves settings when any rail page is chosen", () => {
      nav().openSettings("privacy");
      expect(nav().route).toEqual({ page: "settings", section: "privacy" });

      for (const page of ["home", "dm", "groups", "friends", "archive"] as const) {
        nav().openSettings();
        nav().goToPage(page);
        expect(nav().route.page).toBe(page);
      }
    });

    it("leaves settings when a conversation is opened", () => {
      nav().openSettings();
      nav().openConversation({ id: "c1", type: "group" });
      expect(nav().route).toEqual({ page: "groups", conversationId: "c1" });
    });

    it("closeSettings returns to the last non-settings route", () => {
      nav().openConversation({ id: "c1", type: "dm" });
      nav().openSettings("profile");
      nav().openSettings("keybinds");
      nav().closeSettings();
      expect(nav().route).toEqual({ page: "dm", conversationId: "c1" });
    });

    it("closeSettings falls back to Home with no prior route", () => {
      nav().openSettings();
      nav().closeSettings();
      expect(nav().route).toEqual({ page: "home" });
    });
  });

  it("reopens the last conversation when returning to a tab", () => {
    nav().openConversation({ id: "dm-1", type: "dm" });
    nav().openConversation({ id: "grp-1", type: "group" });
    nav().goToPage("friends");
    nav().goToPage("dm");
    expect(nav().route).toEqual({ page: "dm", conversationId: "dm-1" });
    nav().goToPage("groups");
    expect(nav().route).toEqual({ page: "groups", conversationId: "grp-1" });
  });

  it("opens archived conversations on the archive page", () => {
    nav().openConversation({ id: "old", type: "dm" }, { archived: true });
    expect(nav().route).toEqual({ page: "archive", conversationId: "old" });
  });

  it("walks history with back and forward, and a new navigation clears forward", () => {
    nav().goToPage("friends");
    nav().openConversation({ id: "c1", type: "dm" });
    nav().back();
    expect(nav().route).toEqual({ page: "friends" });
    nav().back();
    expect(nav().route).toEqual({ page: "home" });
    nav().back();
    expect(nav().route).toEqual({ page: "home" });

    nav().forward();
    expect(nav().route).toEqual({ page: "friends" });

    nav().goToPage("archive");
    expect(nav().future).toEqual([]);
  });

  it("ignores navigation to the current route", () => {
    nav().goToPage("friends");
    nav().goToPage("friends");
    expect(nav().past).toHaveLength(1);
  });

  it("forgets a deleted conversation everywhere", () => {
    nav().openConversation({ id: "gone", type: "dm" });
    nav().goToPage("friends");
    nav().openConversation({ id: "gone", type: "dm" });

    nav().forgetConversation("gone");

    expect(nav().route).toEqual({ page: "dm", conversationId: null });
    expect(nav().past.some((r) => "conversationId" in r && r.conversationId === "gone")).toBe(false);
    nav().goToPage("home");
    nav().goToPage("dm");
    expect(nav().route).toEqual({ page: "dm", conversationId: null });
  });
});
