// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * Push registration on phones (mobile plan M4): registered in "all" mode with this device's
 * muted chats, unregistered otherwise, and nothing at all where there is no push (desktop).
 */

const api = { registerPush: vi.fn(async () => ({ registered: true })), unregisterPush: vi.fn(async () => ({ registered: false })) };
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args)]))
}));

const { usePushRegistration } = await import("../usePushRegistration");
const { setPlatform } = await import("../../../platform");
const { useAuthStore } = await import("../../../stores/authStore");
const { usePrefsStore } = await import("../../../stores/prefsStore");

const pushToken = vi.fn(async () => ({ platform: "apns" as const, token: "ab".repeat(32) }));

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of [...Object.values(api), pushToken]) fn.mockClear();
  setPlatform({ kind: "ios", deviceName: "Orbit iOS", pushToken });
  useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
  usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate("me");
});

describe("push registration", () => {
  it("registers this phone with its muted chats in 'all' mode", async () => {
    usePrefsStore.getState().toggleMuted("c-muted");
    renderHook(() => usePushRegistration());
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.registerPush).toHaveBeenCalledWith({ platform: "apns", token: "ab".repeat(32), mutedConversationIds: ["c-muted"] }, "t");
  });

  it("unregisters when notifications are off or mentions-only (the server can't see mentions)", async () => {
    usePrefsStore.getState().setNotifications({ mode: "mentions" });
    renderHook(() => usePushRegistration());
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.unregisterPush).toHaveBeenCalledWith("t");
    expect(pushToken).not.toHaveBeenCalled();
  });

  it("does nothing where there is no push", async () => {
    setPlatform({ kind: "desktop", deviceName: "Orbit Desktop" });
    renderHook(() => usePushRegistration());
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.registerPush).not.toHaveBeenCalled();
    expect(api.unregisterPush).not.toHaveBeenCalled();
  });
});
