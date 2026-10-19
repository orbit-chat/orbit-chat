// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = {
  getFriends: vi.fn(),
  getFriendRequests: vi.fn(),
  acceptFriendRequest: vi.fn(async () => ({})),
  declineFriendRequest: vi.fn(async () => ({})),
  cancelFriendRequest: vi.fn(async () => ({})),
  sendFriendRequest: vi.fn(async () => ({})),
  removeFriend: vi.fn(async () => ({})),
  searchUsers: vi.fn(),
  getUser: vi.fn(async (id: string) => ({ id, username: id, bio: `Bio of ${id}` })),
  getConversations: vi.fn(async () => [])
};
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args)]))
}));

const { FriendsPage } = await import("../FriendsPage");
const { TooltipProvider } = await import("../../../ui");
const { useAuthStore } = await import("../../../stores/authStore");
const { useProfilesStore } = await import("../../../stores/profilesStore");
const { useSocketStore } = await import("../../../stores/socketStore");

const person = (id: string, presence: string, extra: Record<string, unknown> = {}) => ({ id, username: id, presence, ...extra });
const item = (id: string, direction: string, user: ReturnType<typeof person>) => ({ id, status: "accepted", createdAt: "", updatedAt: "", direction, user });

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <FriendsPage />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
  useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
  useProfilesStore.setState({ byId: { me: { id: "me", username: "me", deleteMessagesOnUnfriend: false } }, loadingById: {}, errorById: {} });
  useSocketStore.setState({ socket: null });
  api.getFriends.mockResolvedValue([
    item("f1", "friend", person("ada", "online", { displayName: "Ada Lovelace", statusText: "Hiking" })),
    item("f2", "friend", person("bob", "offline"))
  ]);
  api.getFriendRequests.mockResolvedValue({
    incoming: [item("r1", "incoming", person("cy", "online"))],
    outgoing: [item("r2", "outgoing", person("dee", "offline"))]
  });
  api.searchUsers.mockResolvedValue([person("eve", "online"), person("ada", "online")]);
});

describe("FriendsPage", () => {
  it("lists friends by presence and opens on pending requests", async () => {
    renderPage();
    const list = await screen.findByRole("complementary", { name: "Friends" });
    await waitFor(() => expect(within(list).getByText("Online — 1")).toBeInTheDocument());
    expect(within(list).getByText("Offline — 1")).toBeInTheDocument();
    expect(within(list).getByText("Hiking")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Friend requests" })).toBeInTheDocument();
  });

  it("accepts, declines and cancels requests", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Requests/ }));
    const incoming = await screen.findByRole("list", { name: "Incoming requests" });
    await user.click(within(incoming).getByRole("button", { name: "Accept" }));
    expect(api.acceptFriendRequest).toHaveBeenCalledWith("r1", "t");
    await user.click(within(incoming).getByRole("button", { name: "Decline" }));
    expect(api.declineFriendRequest).toHaveBeenCalledWith("r1", "t");
    await user.click(within(screen.getByRole("list", { name: "Sent requests" })).getByRole("button", { name: "Cancel" }));
    expect(api.cancelFriendRequest).toHaveBeenCalledWith("r2", "t");
  });

  it("finds people and shows the right action for each", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add friend" }));
    await user.type(screen.getByLabelText("Search by username"), "e");
    const people = await screen.findByRole("list", { name: "People" });
    await waitFor(() => expect(within(people).getAllByRole("listitem")).toHaveLength(2));
    const eve = within(people).getByText("eve", { selector: "span" }).closest("li")!;
    await user.click(within(eve).getByRole("button", { name: "Add friend" }));
    expect(api.sendFriendRequest).toHaveBeenCalledWith("eve", "t");
    const ada = within(people).getAllByRole("listitem").find((li) => li.textContent?.includes("@ada"))!;
    expect(within(ada).getByRole("button", { name: "Message" })).toBeInTheDocument();
  });

  it("shows a friend's profile and removes them after confirming", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
    const card = await screen.findByRole("article", { name: "Profile of Ada Lovelace" });
    expect(await within(card).findByText("Bio of ada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove friend" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Ada Lovelace?" });
    expect(dialog).toHaveTextContent("Your direct chat stays");
    await user.click(within(dialog).getByRole("button", { name: "Remove friend" }));
    expect(api.removeFriend).toHaveBeenCalledWith("ada", "t");
    await waitFor(() => expect(api.getConversations).toHaveBeenCalled());
  });
});
