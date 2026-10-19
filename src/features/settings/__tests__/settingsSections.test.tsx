// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = {
  updateMyProfile: vi.fn(),
  getRecoveryCodeStatus: vi.fn(),
  refreshRecoveryCodes: vi.fn(),
  disableRecoveryCodes: vi.fn()
};
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]))
}));

const { SettingsPage } = await import("../SettingsPage");
const { TooltipProvider } = await import("../../../ui");
const { useAuthStore } = await import("../../../stores/authStore");
const { useProfilesStore } = await import("../../../stores/profilesStore");
const { useNavigationStore } = await import("../../../stores/navigationStore");

const appInfo = { version: "1.0.0", platform: "win32", isMac: false, isDesktop: false };
const me = { id: "me", username: "me", displayName: "Old Name", presence: "online" as const, deleteMessagesOnUnfriend: true };

function renderSettings(section: "profile" | "privacy") {
  useNavigationStore.getState().reset();
  useNavigationStore.getState().goToPage("friends");
  useNavigationStore.getState().openSettings(section);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <SettingsPage section={section} appInfo={appInfo} updateStatus={null} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  useAuthStore.setState({ user: { id: "me", username: "me" }, token: "t" });
  useProfilesStore.setState({ byId: { me }, loadingById: {}, errorById: {} });
  api.updateMyProfile.mockImplementation(async (data) => ({ ...me, ...data }));
  api.getRecoveryCodeStatus.mockResolvedValue({ active: true, total: 8, remaining: 6 });
});

describe("Profile settings", () => {
  it("saves edits and previews them live", async () => {
    const user = userEvent.setup();
    renderSettings("profile");
    const save = screen.getByRole("button", { name: "Save profile" });
    expect(save).toBeDisabled();

    const name = screen.getByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Ada");
    await user.type(screen.getByLabelText("Status text"), "Hiking");
    await user.click(screen.getByRole("radio", { name: /Do not disturb/ }));
    expect(within(screen.getByRole("complementary", { name: "Preview" })).getByRole("heading", { name: "Ada" })).toBeInTheDocument();

    await user.click(save);
    await waitFor(() => expect(api.updateMyProfile).toHaveBeenCalled());
    expect(api.updateMyProfile.mock.calls[0]![0]).toMatchObject({ displayName: "Ada", statusText: "Hiking", presence: "dnd", links: null });
    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
  });

  it("rejects non-https links before saving", async () => {
    const user = userEvent.setup();
    renderSettings("profile");
    await user.click(screen.getByRole("button", { name: "+ Add link" }));
    await user.type(screen.getByLabelText("Link 1 URL"), "http://insecure.example");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Links must start with https://")).toBeInTheDocument();
    expect(api.updateMyProfile).not.toHaveBeenCalled();
  });

  it("doesn't close settings when Escape is pressed in a field", async () => {
    const user = userEvent.setup();
    renderSettings("profile");
    await user.click(screen.getByLabelText("Display name"));
    await user.keyboard("{Escape}");
    expect(useNavigationStore.getState().route.page).toBe("settings");
    await user.click(document.body);
    await user.keyboard("{Escape}");
    expect(useNavigationStore.getState().route.page).toBe("friends");
  });
});

describe("Privacy settings", () => {
  it("toggles deleting messages on unfriend", async () => {
    const user = userEvent.setup();
    renderSettings("privacy");
    const toggle = screen.getByRole("switch", { name: "Delete my messages when I unfriend someone" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(api.updateMyProfile).toHaveBeenCalledWith({ deleteMessagesOnUnfriend: false }, "t");
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  });

  it("refreshes recovery codes with current ones and shows the new set once", async () => {
    const user = userEvent.setup();
    api.refreshRecoveryCodes.mockResolvedValue({ recoveryCodes: ["new1-aaaa", "new2-bbbb"] });
    renderSettings("privacy");
    expect(await screen.findByText("6 of 8 left")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get new codes…" }));
    const dialog = await screen.findByRole("dialog", { name: "Get new recovery codes" });
    await user.type(within(dialog).getByLabelText("Current recovery codes"), "old1-zzzz{Enter}old2-yyyy");
    await user.click(within(dialog).getByRole("button", { name: "Get new codes" }));
    expect(api.refreshRecoveryCodes).toHaveBeenCalledWith(["old1-zzzz", "old2-yyyy"], "t");
    const codes = await screen.findByRole("list", { name: "New recovery codes" });
    expect(within(codes).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["new1-aaaa", "new2-bbbb"]);
    await user.click(screen.getByRole("button", { name: "I've saved them" }));
    expect(screen.queryByRole("list", { name: "New recovery codes" })).not.toBeInTheDocument();
  });

  it("warns before turning recovery codes off for good", async () => {
    const user = userEvent.setup();
    api.disableRecoveryCodes.mockResolvedValue({ success: true });
    renderSettings("privacy");
    await user.click(await screen.findByRole("button", { name: "Turn off recovery codes…" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn off recovery codes?" });
    expect(dialog).toHaveTextContent("can't be undone");
    expect(within(dialog).getByRole("button", { name: "Turn off permanently" })).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Current recovery codes"), "old1-zzzz");
    await user.click(within(dialog).getByRole("button", { name: "Turn off permanently" }));
    expect(api.disableRecoveryCodes).toHaveBeenCalledWith(["old1-zzzz"], "t");
  });
});
