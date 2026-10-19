// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../../../ui";
import { ConversationSidebar, type ConversationPage } from "../ConversationSidebar";
import { useConversationsStore } from "../conversationsStore";
import { useAuthStore } from "../../../stores/authStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { useNavigationStore } from "../../../stores/navigationStore";
import { usePrefsStore } from "../../../stores/prefsStore";
import { useChatLockStore } from "../../../stores/chatLockStore";
import { ME, dm, group, message } from "./fixtures";

function renderSidebar(page: ConversationPage = "home", selectedId: string | null = null) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
      <TooltipProvider>
        <ConversationSidebar page={page} selectedId={selectedId} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const rows = () =>
  [...document.querySelectorAll<HTMLButtonElement>("[data-conversation-row] > button:first-child")].map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  useAuthStore.setState({ user: ME, token: "t" });
  usePrefsStore.setState({ userId: ME.id, byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate(ME.id);
  useNavigationStore.getState().reset();
  useChatLockStore.setState({ unlocked: {} });
  useMessagesStore.setState({
    byConversation: {
      a: [message("1", Date.parse("2026-02-01"), "ada")],
      g: [message("2", Date.parse("2026-03-01"), "bob")]
    },
    unreadCountByConversation: { a: 2 },
    activeConversationId: null
  });
  useConversationsStore.setState({
    conversations: [dm("a", "ada"), dm("b", "bob"), group("g", ["ada", "bob"], { name: "Crew" }), dm("x", "xena", { passcodeEnabled: true })],
    status: "ready",
    error: null
  });
});

describe("ConversationSidebar", () => {
  it("lists active chats by recency with unread and lock state in the accessible name", () => {
    renderSidebar("home");
    expect(rows()).toEqual(["Crew", "ada, 2 unread", "bob", "xena, locked"]);
  });

  it("filters to DMs or groups per page", () => {
    const { unmount } = renderSidebar("dm");
    expect(rows()).toEqual(["ada, 2 unread", "bob", "xena, locked"]);
    unmount();
    renderSidebar("groups");
    expect(rows()).toEqual(["Crew"]);
  });

  it("opens a conversation on the page matching its type", async () => {
    renderSidebar("home");
    await userEvent.click(screen.getByRole("button", { name: "Crew" }));
    expect(useNavigationStore.getState().route).toEqual({ page: "groups", conversationId: "g" });
  });

  it("filters by title or member", async () => {
    const user = userEvent.setup();
    renderSidebar("home");
    await user.type(screen.getByLabelText("Filter chats"), "bob");
    expect(rows()).toEqual(["Crew", "bob"]);
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Filter chats")).toHaveValue("");
    await user.type(screen.getByLabelText("Filter chats"), "nobody");
    expect(screen.getByText('No chats match "nobody".')).toBeInTheDocument();
  });

  it("pins from the right-click menu into a Pinned section", async () => {
    const user = userEvent.setup();
    renderSidebar("home");
    fireEvent.contextMenu(screen.getByRole("button", { name: "bob" }));
    await user.click(await screen.findByRole("menuitem", { name: "Pin to top" }));

    expect(rows()[0]).toBe("bob");
    const pinnedSection = screen.getByRole("heading", { name: "Pinned" }).closest("section")!;
    expect(within(pinnedSection).getByRole("button", { name: "bob" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
  });

  it("archives from the … menu, and the chat shows up on the archive page", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar("home");
    await user.click(screen.getByRole("button", { name: "More actions for bob" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));
    expect(rows()).not.toContain("bob");
    unmount();

    renderSidebar("archive");
    expect(rows()).toEqual(["bob"]);
    await user.click(screen.getByRole("button", { name: "bob" }));
    expect(useNavigationStore.getState().route).toEqual({ page: "archive", conversationId: "b" });
  });

  it("marks a chat read from its menu", async () => {
    const user = userEvent.setup();
    renderSidebar("home");
    fireEvent.contextMenu(screen.getByRole("button", { name: "ada, 2 unread" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark as read" }));
    expect(useMessagesStore.getState().unreadCountByConversation.a).toBe(0);
    expect(rows()).toContain("ada");
  });

  it("offers Lock chat only for an unlocked passcode chat", async () => {
    const user = userEvent.setup();
    useChatLockStore.setState({ unlocked: { x: { unlockedAt: Date.now(), lockMode: "on_leave", lockTimeoutSeconds: null } } });
    renderSidebar("home");
    fireEvent.contextMenu(screen.getByRole("button", { name: "xena" }));
    await user.click(await screen.findByRole("menuitem", { name: "Lock chat" }));
    expect(useChatLockStore.getState().unlocked.x).toBeUndefined();
    expect(rows()).toContain("xena, locked");
  });

  it("moves focus between rows with the arrow keys", async () => {
    const user = userEvent.setup();
    renderSidebar("home");
    screen.getByRole("button", { name: "Crew" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "ada, 2 unread" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: "xena, locked" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("button", { name: "Crew" })).toHaveFocus();
  });

  it("shows loading, error and empty states", () => {
    useConversationsStore.setState({ conversations: [], status: "loading" });
    const { rerender } = renderSidebar("home");
    expect(screen.getByRole("status", { name: "Loading chats" })).toBeInTheDocument();

    useConversationsStore.setState({ status: "error", error: "Server unreachable" });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <ConversationSidebar page="home" selectedId={null} />
        </TooltipProvider>
      </QueryClientProvider>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Server unreachable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    act(() => useConversationsStore.setState({ status: "ready", error: null }));
    expect(screen.getByText(/No chats yet/)).toBeInTheDocument();
  });
});
