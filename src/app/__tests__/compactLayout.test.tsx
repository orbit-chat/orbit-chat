// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dm } from "../../features/conversations/__tests__/fixtures";

/**
 * Phone layout (mobile plan M2): one pane at a time, driven by the route. The list fills the
 * screen with a bottom tab bar; opening a chat replaces it (no tab bar) and Back returns; settings
 * shows its section list, then one section with a back button.
 */

const { TooltipProvider } = await import("../../ui");
const { AppShell } = await import("../AppShell");
const { useAuthStore } = await import("../../stores/authStore");
const { useNavigationStore } = await import("../../stores/navigationStore");
const { usePrefsStore } = await import("../../stores/prefsStore");
const { useConversationsStore } = await import("../../features/conversations/conversationsStore");

const appInfo = { version: "1.0.0-test", platform: "win32", isMac: false, isDesktop: false };

function phoneWidth(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches && query.includes("max-width: 767px"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <AppShell appInfo={appInfo} updateStatus={null} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  phoneWidth(true);
  useNavigationStore.getState().reset();
  useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
  usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate("me");
  useConversationsStore.setState({ conversations: [dm("c1", "ada")], status: "ready" });
});

afterEach(() => {
  // @ts-expect-error restore jsdom's default (no matchMedia)
  delete window.matchMedia;
});

describe("phone layout", () => {
  it("shows the chat list with a bottom tab bar instead of the rail", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archived chats" })).toBeInTheDocument();
  });

  it("replaces the list with the chat, hides the tab bar, and goes back", async () => {
    const user = userEvent.setup();
    renderShell();
    useNavigationStore.getState().openConversation({ id: "c1", type: "dm" });
    await screen.findByRole("button", { name: "Back to chats" });
    expect(screen.queryByRole("complementary", { name: "Home" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(screen.getByRole("complementary", { name: "Home" })).toBeInTheDocument();
    expect(useNavigationStore.getState().route).toEqual({ page: "home" });
  });

  it("shows settings as a list, then one section with a back button", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Settings" }));
    const sections = screen.getByRole("navigation", { name: "Settings sections" });
    await user.click(within(sections).getByRole("button", { name: "About" }));
    expect(screen.getByRole("button", { name: "All settings" })).toBeInTheDocument();
    // Hidden with Tailwind's `hidden` class (CSS isn't loaded here, so check the class itself).
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toHaveClass("hidden");
    await user.click(screen.getByRole("button", { name: "All settings" }));
    expect(screen.getByRole("navigation", { name: "Settings sections" })).not.toHaveClass("hidden");
    expect(screen.getByRole("button", { name: "All settings" }).closest("div.overflow-y-auto")).toHaveClass("hidden");
  });

  it("locks a chat set to lock on leave when the app goes to the background", async () => {
    let appState: ((active: boolean) => void) | null = null;
    const { setPlatform } = await import("../../platform");
    const { useChatLockStore } = await import("../../stores/chatLockStore");
    setPlatform({ kind: "ios", deviceName: "Orbit iOS", onAppStateChange: (listener) => ((appState = listener), () => (appState = null)) });
    useChatLockStore.getState().unlock("c1", "on_leave", null);
    useNavigationStore.getState().openConversation({ id: "c1", type: "dm" });
    renderShell();
    expect(useChatLockStore.getState().unlocked.c1).toBeDefined();
    act(() => appState?.(false));
    expect(useChatLockStore.getState().unlocked.c1).toBeUndefined();
    setPlatform(null);
  });

  it("keeps the desktop layout on wide windows", () => {
    phoneWidth(false);
    renderShell();
    expect(screen.queryByRole("button", { name: "Archived chats" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });
});
