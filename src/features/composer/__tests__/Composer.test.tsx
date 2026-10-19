// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../../../ui";
import { Composer } from "../Composer";
import { useDraftsStore } from "../draftsStore";
import { useOutboxStore } from "../outboxStore";
import { TYPING_IDLE_MS } from "../useTypingSignals";
import { useSocketStore } from "../../../stores/socketStore";
import { usePrefsStore } from "../../../stores/prefsStore";
import { useMessagesStore } from "../../../stores/messagesStore";
import { useProfilesStore } from "../../../stores/profilesStore";
import { group } from "../../conversations/__tests__/fixtures";

const send = vi.fn(async () => {});
const emit = vi.fn();
const conversation = group("c", ["ada", "adam", "grace"]);
const me = { id: "me", username: "me" };

function renderComposer() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { enabled: false } } })}>
      <TooltipProvider>
        <Composer conversation={conversation} me={me} title="Crew" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const box = () => screen.getByRole("combobox", { name: "Message Crew" }) as HTMLTextAreaElement;

beforeEach(() => {
  send.mockClear();
  emit.mockClear();
  useOutboxStore.setState({ send });
  useDraftsStore.getState().reset();
  useSocketStore.setState({ socket: { emit } as never });
  usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate("me");
  useProfilesStore.setState({ byId: { grace: { id: "grace", username: "grace", displayName: "Grace Hopper" } } });
  useMessagesStore.setState({ byConversation: { c: [{ id: "m1", senderId: "ada", sender: "ada", cipherText: "x", createdAt: 1 }] } });
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => vi.useRealTimers());

describe("Composer", () => {
  it("sends on Enter, adds a line on Shift+Enter, and clears the draft", async () => {
    const user = userEvent.setup();
    renderComposer();
    expect(box()).toHaveFocus();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await user.type(box(), "hello{Shift>}{Enter}{/Shift}world");
    expect(box()).toHaveValue("hello\nworld");
    await user.keyboard("{Enter}");

    expect(send).toHaveBeenCalledWith({ conversationId: "c", text: "hello\nworld", files: [], gif: null, parentMessageId: null });
    expect(box()).toHaveValue("");
  });

  it("doesn't send whitespace", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(box(), "   {Enter}");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the draft per conversation across remounts", async () => {
    const user = userEvent.setup();
    const { unmount } = renderComposer();
    await user.type(box(), "half a thought");
    unmount();
    renderComposer();
    expect(box()).toHaveValue("half a thought");
  });

  it("suggests members after @ and completes with the keyboard", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(box(), "hey @ad");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent?.replace(/^[A-Z]/, ""))).toEqual(["ada@ada", "adam@adam"]);
    expect(box()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(box()).toHaveValue("hey @adam ");
    expect(send).not.toHaveBeenCalled();

    await user.type(box(), "@hop");
    await user.keyboard("{Tab}");
    expect(box()).toHaveValue("hey @adam @grace ");
  });

  it("shows the reply target and Escape cancels it", async () => {
    const user = userEvent.setup();
    act(() => useDraftsStore.getState().setReplyTo("c", "m1"));
    renderComposer();
    expect(screen.getByText(/Replying to/)).toHaveTextContent("Replying to ada");
    await user.type(box(), "sure{Escape}");
    expect(screen.queryByText(/Replying to/)).not.toBeInTheDocument();

    act(() => useDraftsStore.getState().setReplyTo("c", "m1"));
    await user.keyboard("{Enter}");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: "sure", parentMessageId: "m1" }));
  });

  it("attaches pasted images, rejects videos, and removes attachments", async () => {
    const user = userEvent.setup();
    renderComposer();
    const image = new File(["png"], "shot.png", { type: "image/png" });
    fireEvent.paste(box(), { clipboardData: { files: [image] } });
    expect(screen.getByRole("list", { name: "Attachments" })).toHaveTextContent("shot.png");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();

    fireEvent.drop(box().closest("footer")!, { dataTransfer: { files: [new File(["v"], "clip.mov", { type: "video/quicktime" })], types: ["Files"] } });
    expect(screen.getByRole("alert")).toHaveTextContent("clip.mov: videos can't be uploaded");

    await user.click(screen.getByRole("button", { name: "Remove shot.png" }));
    expect(screen.queryByRole("list", { name: "Attachments" })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("opens the emoji picker with Ctrl+E and inserts at the caret", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(box(), "ab");
    box().setSelectionRange(1, 1);
    await user.keyboard("{Control>}e{/Control}");
    await user.click(await screen.findByRole("option", { name: "👍" }));
    expect(box()).toHaveValue("a👍b");
    expect(usePrefsStore.getState().byUser.me!.recentEmojis[0]).toBe("👍");
  });

  it("announces typing once, then stops after a pause or on send", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderComposer();
    await user.type(box(), "abc");
    expect(emit.mock.calls.filter(([e]) => e === "typing_start")).toHaveLength(1);
    act(() => vi.advanceTimersByTime(TYPING_IDLE_MS + 10));
    expect(emit).toHaveBeenLastCalledWith("typing_stop", { conversationId: "c" });

    await user.type(box(), "d{Enter}");
    expect(emit.mock.calls.filter(([e]) => e === "typing_start")).toHaveLength(2);
    expect(emit).toHaveBeenLastCalledWith("typing_stop", { conversationId: "c" });
  });

  it("stays quiet when typing indicators are off for the chat", async () => {
    const user = userEvent.setup();
    act(() => usePrefsStore.getState().setChatRealtime("c", { typingIndicators: false }));
    renderComposer();
    await user.type(box(), "abc");
    expect(emit).not.toHaveBeenCalled();
  });
});
