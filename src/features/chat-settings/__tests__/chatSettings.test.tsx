// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dm, group } from "../../conversations/__tests__/fixtures";

const api = {
  verifyPasscode: vi.fn(),
  bypassPasscode: vi.fn(),
  updateChatSettings: vi.fn(),
  requestDisablePasscode: vi.fn(),
  reenablePasscode: vi.fn(),
  getConversations: vi.fn()
};
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]))
}));
const groupKeys = { leaveGroup: vi.fn(async () => {}), deleteDirectMessage: vi.fn(async () => {}), removeGroupMember: vi.fn(async () => {}), createGroup: vi.fn(), addGroupMembers: vi.fn() };
vi.mock("../../groups/groupKeys", () => groupKeys);

const { TooltipProvider } = await import("../../../ui");
const { PasscodeLockScreen } = await import("../PasscodeLockScreen");
const { DialogHost } = await import("../DialogHost");
const { useDialogStore } = await import("../dialogStore");
const { usePasscodeRevealStore } = await import("../passcodeRevealStore");
const { useChatLockEffects } = await import("../useChatLockEffects");
const { useConversationsStore } = await import("../../conversations/conversationsStore");
const { useAuthStore } = await import("../../../stores/authStore");
const { useChatLockStore } = await import("../../../stores/chatLockStore");
const { usePrefsStore } = await import("../../../stores/prefsStore");
const { useNavigationStore } = await import("../../../stores/navigationStore");
const { friendsKey } = await import("../../friends/friendsQueries");

let queryClient: QueryClient;
function wrap(ui: React.ReactNode) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(groupKeys)]) fn.mockReset();
  api.getConversations.mockResolvedValue([]);
  queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
  useChatLockStore.setState({ unlocked: {} });
  useDialogStore.setState({ current: null });
  usePasscodeRevealStore.setState({ current: null });
  usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate("me");
  useNavigationStore.getState().reset();
  useConversationsStore.getState().reset();
});

describe("PasscodeLockScreen", () => {
  const locked = dm("d", "ada", { passcodeEnabled: true, passcodeLength: 4 });

  it("unlocks with the right passcode", async () => {
    const user = userEvent.setup();
    api.verifyPasscode.mockResolvedValue({ success: true });
    render(wrap(<PasscodeLockScreen conversation={locked} title="ada" />));
    const unlock = screen.getByRole("button", { name: "Unlock" });
    await user.type(screen.getByLabelText("Chat passcode"), "12a3");
    expect(screen.getByLabelText("Chat passcode")).toHaveValue("123");
    expect(unlock).toBeDisabled();
    await user.type(screen.getByLabelText("Chat passcode"), "4{Enter}");
    expect(api.verifyPasscode).toHaveBeenCalledWith("d", "1234", "t");
    await waitFor(() => expect(useChatLockStore.getState().unlocked.d).toBeDefined());
  });

  it("shows the error and clears the field on a wrong passcode", async () => {
    const user = userEvent.setup();
    api.verifyPasscode.mockRejectedValue(new Error("Incorrect passcode"));
    render(wrap(<PasscodeLockScreen conversation={locked} title="ada" />));
    await user.type(screen.getByLabelText("Chat passcode"), "9999{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect passcode");
    expect(screen.getByLabelText("Chat passcode")).toHaveValue("");
    expect(useChatLockStore.getState().unlocked.d).toBeUndefined();
  });

  it("bypasses with a recovery code after a clear warning", async () => {
    const user = userEvent.setup();
    api.bypassPasscode.mockResolvedValue({ success: true });
    render(wrap(<PasscodeLockScreen conversation={locked} title="ada" />));
    await user.click(screen.getByRole("button", { name: /Use a recovery code/ }));
    expect(screen.getByRole("status")).toHaveTextContent("turns off the passcode");
    await user.type(screen.getByLabelText("Recovery code"), " abcd-1234 ");
    await user.click(screen.getByRole("button", { name: "Unlock with code" }));
    expect(api.bypassPasscode).toHaveBeenCalledWith("d", "abcd-1234", "t");
    await waitFor(() => expect(api.getConversations).toHaveBeenCalled());
    expect(useChatLockStore.getState().unlocked.d).toBeDefined();
  });
});

describe("one-time passcode reveal", () => {
  function Harness({ conversationId }: { conversationId: string }) {
    const conversation = useConversationsStore((s) => s.conversations.find((c) => c.id === conversationId));
    useChatLockEffects(conversation, true);
    return <DialogHost />;
  }

  it("shows a pending passcode when the chat opens, and only 'I've saved it' closes it", async () => {
    const user = userEvent.setup();
    useConversationsStore.getState().upsert(group("g", ["ada"], { name: "Crew" }));
    useConversationsStore.getState().setPendingPasscode("g", { passcode: "4821", label: "Crew" });
    render(wrap(<Harness conversationId="g" />));

    const dialog = await screen.findByRole("dialog", { name: "Save this chat's passcode" });
    expect(within(dialog).getByText("4821")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "I've saved it" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useConversationsStore.getState().pendingPasscodes.g).toBeUndefined();
  });
});

describe("chat settings dialog", () => {
  const openSettings = (conversation: ReturnType<typeof dm>) => {
    useConversationsStore.getState().upsert(conversation);
    render(wrap(<DialogHost />));
    act(() => useDialogStore.getState().open({ kind: "chatSettings", conversationId: conversation.id }));
  };

  it("saves name and lock mode, and validates the passcode", async () => {
    const user = userEvent.setup();
    const conversation = dm("d", "ada", { passcodeEnabled: true, passcodeLength: 4, lockMode: "on_leave" });
    api.updateChatSettings.mockImplementation(async (_id, body) => ({ ...conversation, ...body }));
    openSettings(conversation);
    const dialog = await screen.findByRole("dialog", { name: "Chat settings" });
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Chat name"), "Ada & me");
    await user.click(within(dialog).getByRole("radio", { name: /After inactivity/ }));
    await user.click(within(dialog).getByRole("button", { name: "5 min" }));
    await user.type(within(dialog).getByLabelText("New passcode"), "12");
    expect(within(dialog).getByText("The new passcode must be 4 digits.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText("New passcode"), "34");
    await user.click(save);

    expect(api.updateChatSettings).toHaveBeenCalledWith(
      "d",
      { name: "Ada & me", lockMode: "after_inactivity", passcodeLength: 4, passcode: "1234", lockTimeoutSeconds: 300 },
      "t"
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useConversationsStore.getState().conversations[0]!.name).toBe("Ada & me");
  });

  it("changes device-only toggles immediately", async () => {
    const user = userEvent.setup();
    openSettings(dm("d", "ada"));
    await user.click(await screen.findByRole("switch", { name: "Send read receipts" }));
    expect(usePrefsStore.getState().byUser.me!.chatRealtime.d).toEqual({ readReceipts: false, typingIndicators: true });
  });

  it("asks to turn the passcode off", async () => {
    const user = userEvent.setup();
    const conversation = dm("d", "ada", { passcodeEnabled: true });
    api.requestDisablePasscode.mockResolvedValue({ status: "pending", conversation: { ...conversation, passcodeDisableRequestedBy: "me" } });
    openSettings(conversation);
    await user.click(await screen.findByRole("button", { name: "Ask to turn off" }));
    expect(await screen.findByText(/Waiting for the others to agree/)).toBeInTheDocument();
  });

  it("lets the owner remove a member after confirming", async () => {
    const user = userEvent.setup();
    openSettings(group("g", ["ada", "bob"], { createdBy: "me" }));
    await user.click(await screen.findByRole("button", { name: "Remove bob" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(groupKeys.removeGroupMember).toHaveBeenCalledWith(expect.objectContaining({ userId: "bob" }));
  });

  it("hides member removal from non-owners", async () => {
    openSettings(group("g", ["ada", "bob"], { createdBy: "ada" }));
    await screen.findByText("Members (3)");
    expect(screen.queryByRole("button", { name: /Remove bob/ })).not.toBeInTheDocument();
  });

  it("opens the leave dialog from the danger zone and leaves with the wipe choice", async () => {
    const user = userEvent.setup();
    openSettings(group("g", ["ada"], { name: "Crew" }));
    await user.click(await screen.findByRole("button", { name: "Leave group…" }));
    const dialog = await screen.findByRole("dialog", { name: "Leave Crew?" });
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Leave group" }));
    expect(groupKeys.leaveGroup).toHaveBeenCalledWith(expect.objectContaining({ wipeMessages: false }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("deletes a DM and refreshes friends", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    useConversationsStore.getState().upsert(dm("d", "ada"));
    render(wrap(<DialogHost />));
    act(() => useDialogStore.getState().open({ kind: "deleteOrLeave", conversationId: "d" }));
    await user.click(await screen.findByRole("button", { name: "Delete and unfriend" }));
    expect(groupKeys.deleteDirectMessage).toHaveBeenCalled();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: friendsKey }));
  });
});

describe("create group dialog", () => {
  it("creates a group from picked friends and opens it", async () => {
    const user = userEvent.setup();
    queryClient.setQueryData(friendsKey, {
      friends: [
        { id: "f1", status: "accepted", createdAt: "", updatedAt: "", direction: "friend", user: { id: "ada", username: "ada", displayName: "Ada Lovelace" } },
        { id: "f2", status: "accepted", createdAt: "", updatedAt: "", direction: "friend", user: { id: "bob", username: "bob" } }
      ],
      requests: { incoming: [], outgoing: [] }
    });
    groupKeys.createGroup.mockResolvedValue(group("new", ["ada"], { name: "Hikers" }));
    render(wrap(<DialogHost />));
    act(() => useDialogStore.getState().open({ kind: "createGroup" }));

    const dialog = await screen.findByRole("dialog", { name: "New group" });
    await user.type(within(dialog).getByLabelText("Group name"), "Hikers");
    await user.click(within(dialog).getByRole("option", { name: /Ada Lovelace/ }));
    expect(within(dialog).getByRole("list", { name: "Selected people" })).toHaveTextContent("@ada");
    await user.click(within(dialog).getByRole("button", { name: "Create group (2)" }));

    expect(groupKeys.createGroup).toHaveBeenCalledWith(expect.objectContaining({ name: "Hikers", members: [{ id: "ada", username: "ada" }] }));
    await waitFor(() => expect(useNavigationStore.getState().route).toEqual({ page: "groups", conversationId: "new" }));
  });
});
