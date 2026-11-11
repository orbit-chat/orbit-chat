// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform } from "../../../platform";

/**
 * App lock (mobile plan M5): when on, the app is covered at launch and every time it returns
 * from the background until Face ID / fingerprint succeeds; it can only be turned on after a
 * successful check, so nobody locks themselves out.
 */

const { AppLockGate, enableAppLock, useAppLockStore } = await import("../appLock");

let appState: ((active: boolean) => void) | null = null;
const verify = vi.fn(async () => true);

beforeEach(() => {
  localStorage.clear();
  verify.mockReset().mockResolvedValue(true);
  appState = null;
  setPlatform({
    kind: "ios",
    deviceName: "Orbit iOS",
    biometric: { available: async () => true, verify },
    onAppStateChange: (listener) => {
      appState = listener;
      return () => (appState = null);
    }
  });
  useAppLockStore.setState({ enabled: false, locked: false });
});

describe("app lock", () => {
  it("turns on only after a successful check, and remembers it for the next launch", async () => {
    verify.mockResolvedValueOnce(false);
    expect(await enableAppLock()).toBe(false);
    expect(useAppLockStore.getState().enabled).toBe(false);
    expect(await enableAppLock()).toBe(true);
    expect(localStorage.getItem("orbit:appLock")).toBe("1");
  });

  it("covers the app until unlocked, and locks again in the background", async () => {
    useAppLockStore.setState({ enabled: true, locked: true });
    verify.mockResolvedValueOnce(false);
    render(
      <AppLockGate>
        <p>secret chats</p>
      </AppLockGate>
    );
    expect(screen.getByRole("dialog", { name: "Orbit is locked" })).toBeInTheDocument();
    expect(screen.queryByText("secret chats")).not.toBeInTheDocument();
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("secret chats")).not.toBeInTheDocument();

    // Coming back to the foreground asks again; this time it succeeds.
    await act(async () => appState?.(true));
    await waitFor(() => expect(screen.getByText("secret chats")).toBeInTheDocument());

    act(() => appState?.(false));
    expect(screen.queryByText("secret chats")).not.toBeInTheDocument();
  });

  it("never covers the app when the lock is off", () => {
    render(
      <AppLockGate>
        <p>chats</p>
      </AppLockGate>
    );
    act(() => appState?.(false));
    expect(screen.getByText("chats")).toBeInTheDocument();
  });
});
