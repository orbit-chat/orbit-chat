// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = {
  updateMyProfile: vi.fn(),
  getRecoveryCodeStatus: vi.fn(),
  refreshRecoveryCodes: vi.fn(),
  disableRecoveryCodes: vi.fn(),
  getMyDevices: vi.fn(),
  getRecentLinkSessions: vi.fn(),
  signOutDevice: vi.fn(),
  createLinkSession: vi.fn(),
  getLinkMessages: vi.fn(),
  failLinkSession: vi.fn()
};
const removeLinkedDevice = vi.fn();
vi.mock("../../devices/revokeDevice", () => ({
  removeLinkedDevice: (...args: unknown[]) => removeLinkedDevice(...args),
  signOutUnlinkedDevice: (params: { token: string; deviceId: string }) => api.signOutDevice(params.deviceId, params.token)
}));
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]))
}));

const { SettingsPage } = await import("../SettingsPage");
const { TooltipProvider } = await import("../../../ui");
const { useAuthStore } = await import("../../../stores/authStore");
const { useProfilesStore } = await import("../../../stores/profilesStore");
const { useNavigationStore } = await import("../../../stores/navigationStore");
const { useE2EEStore } = await import("../../../stores/e2eeStore");

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
  api.getMyDevices.mockResolvedValue({ identityPublished: true, deviceListVersion: 1, devices: [] });
  api.getRecentLinkSessions.mockResolvedValue([]);
  removeLinkedDevice.mockReset();
  useE2EEStore.setState({ deviceIdentityStatusByUserId: {}, perDeviceKeysByUserId: {} });
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

describe("Devices", () => {
  const device = (overrides: Partial<{ id: string; name: string; trusted: boolean; current: boolean; signedIn: boolean }>) => ({
    id: "d1",
    name: "Orbit Desktop",
    lastSeenAt: "2026-11-01T10:00:00.000Z",
    signedIn: true,
    trusted: true,
    current: false,
    ...overrides
  });

  it("lists linked and unlinked devices and marks this one", async () => {
    api.getMyDevices.mockResolvedValue({
      identityPublished: true,
      deviceListVersion: 2,
      devices: [device({ id: "a", current: true }), device({ id: "b", name: "Orbit iOS", trusted: false })]
    });
    renderSettings("privacy");

    const list = await screen.findByRole("list", { name: "Your devices" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("(this device)")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Linked")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Orbit iOS")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Not linked")).toBeInTheDocument();
    expect(screen.getByText(/signed in to your account but isn't linked/)).toBeInTheDocument();
  });

  it("warns when this device is waiting to be linked", async () => {
    useE2EEStore.setState({ deviceIdentityStatusByUserId: { me: "pending" } });
    renderSettings("privacy");
    expect(await screen.findByText(/This device isn't linked to your account yet/)).toBeInTheDocument();
  });

  it("warns loudly when this device holds a different identity", async () => {
    useE2EEStore.setState({ deviceIdentityStatusByUserId: { me: "conflict" } });
    renderSettings("privacy");
    expect(await screen.findByText(/someone else may have signed in/)).toBeInTheDocument();
  });

  it("offers a retry when the list fails to load", async () => {
    const user = userEvent.setup();
    api.getMyDevices.mockRejectedValueOnce(new Error("offline"));
    renderSettings("privacy");
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.getMyDevices).toHaveBeenCalledTimes(2));
  });
});

describe("Device actions (per-device keys)", () => {
  const device = (overrides: Partial<{ id: string; name: string; trusted: boolean; current: boolean; signedIn: boolean }>) => ({
    id: "d1",
    name: "Orbit Desktop",
    lastSeenAt: "2026-11-01T10:00:00.000Z",
    signedIn: true,
    trusted: true,
    current: false,
    ...overrides
  });

  beforeEach(() => {
    useE2EEStore.setState({ deviceIdentityStatusByUserId: { me: "trusted" }, perDeviceKeysByUserId: { me: true } });
    api.getMyDevices.mockResolvedValue({
      identityPublished: true,
      deviceListVersion: 3,
      devices: [
        device({ id: "a", current: true }),
        device({ id: "b", name: "Orbit iOS" }),
        device({ id: "c", name: "Unknown laptop", trusted: false })
      ]
    });
  });

  it("removes a linked device after the user confirms", async () => {
    const user = userEvent.setup();
    removeLinkedDevice.mockResolvedValue({ forgotThisDevice: false });
    renderSettings("privacy");
    const list = await screen.findByRole("list", { name: "Your devices" });
    const phone = within(list).getAllByRole("listitem")[1]!;
    await user.click(within(phone).getByRole("button", { name: "Remove" }));
    expect(screen.getByText(/Every chat gets a new key/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove device" }));
    await waitFor(() => expect(removeLinkedDevice).toHaveBeenCalledWith({ userId: "me", token: "t", deviceId: "b" }));
  });

  it("shows why a removal failed and keeps the dialog open", async () => {
    const user = userEvent.setup();
    removeLinkedDevice.mockRejectedValue(new Error("This is your only linked device."));
    renderSettings("privacy");
    const list = await screen.findByRole("list", { name: "Your devices" });
    await user.click(within(within(list).getAllByRole("listitem")[0]!).getByRole("button", { name: "Forget" }));
    await user.click(screen.getByRole("button", { name: "Forget this device" }));
    expect(await screen.findByText("This is your only linked device.")).toBeInTheDocument();
  });

  it("signs out an unlinked device, and offers no removal for it", async () => {
    const user = userEvent.setup();
    api.signOutDevice.mockResolvedValue({ success: true });
    renderSettings("privacy");
    const list = await screen.findByRole("list", { name: "Your devices" });
    const laptop = within(list).getAllByRole("listitem")[2]!;
    expect(within(laptop).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    await user.click(within(laptop).getByRole("button", { name: "Sign out" }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.signOutDevice).toHaveBeenCalledWith("c", "t"));
  });

  it("opens linking with a code to type on the new device", async () => {
    const user = userEvent.setup();
    api.createLinkSession.mockResolvedValue({ sessionId: "11111111-1111-4111-8111-111111111111", mode: "code", creatorRole: "existing", creatorDeviceId: "a", joinerDeviceId: null, status: "open", failureReason: null, expiresAt: new Date(Date.now() + 120000).toISOString() });
    api.getLinkMessages.mockImplementation(async () => ({ session: (await api.createLinkSession.mock.results[0]!.value), messages: [] }));
    api.failLinkSession.mockResolvedValue({});
    useE2EEStore.setState({ thisDevice: vi.fn(async () => ({ userId: "me", deviceId: "a", encryption: { publicKey: "", privateKey: "" }, signingPrivateKey: "" })) });
    renderSettings("privacy");
    await user.click(await screen.findByRole("button", { name: "Link a device" }));
    await user.click(screen.getByRole("tab", { name: "Show code" }));
    const code = await screen.findByTestId("link-code");
    expect(code.textContent).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(api.createLinkSession).toHaveBeenLastCalledWith({ mode: "code", role: "existing" }, "t");
  });

  it("lists recent linking attempts", async () => {
    api.getRecentLinkSessions.mockResolvedValue([
      { sessionId: "s1", mode: "qr", creatorRole: "existing", creatorDeviceId: "a", joinerDeviceId: "c", status: "failed", failureReason: "key_confirmation_failed", expiresAt: "", createdAt: "2026-11-10T10:00:00.000Z", creatorDeviceName: "Orbit Desktop", joinerDeviceName: "Unknown laptop" }
    ]);
    renderSettings("privacy");
    expect(await screen.findByText(/Linking attempts in the last 7 days \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Orbit Desktop → Unknown laptop/)).toBeInTheDocument();
  });

  it("offers a pending device the way to link itself", async () => {
    useE2EEStore.setState({ deviceIdentityStatusByUserId: { me: "pending" } });
    renderSettings("privacy");
    expect(await screen.findByRole("button", { name: "Link this device" })).toBeInTheDocument();
  });
});

describe("Devices before the account has an identity", () => {
  it("shows devices as setting up without the unlinked-device warning", async () => {
    api.getMyDevices.mockResolvedValue({
      identityPublished: false,
      deviceListVersion: null,
      devices: [
        { id: "a", name: "Orbit Desktop", lastSeenAt: null, signedIn: true, trusted: false, current: true },
        { id: "b", name: "Orbit Desktop", lastSeenAt: null, signedIn: true, trusted: false, current: false }
      ]
    });
    renderSettings("privacy");
    const list = await screen.findByRole("list", { name: "Your devices" });
    expect(within(list).getAllByText("Setting up")).toHaveLength(2);
    expect(screen.queryByText(/isn't linked/)).not.toBeInTheDocument();
  });
});
