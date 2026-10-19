// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../../ui";
import { AppShell } from "../AppShell";
import { UpdateBanner } from "../UpdateBanner";
import { useAuthStore } from "../../stores/authStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { usePrefsStore } from "../../stores/prefsStore";

const appInfo = { version: "1.0.0-test", platform: "win32", isMac: false, isDesktop: false };

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <AppShell appInfo={appInfo} updateStatus={null} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const rail = () => screen.getByRole("navigation", { name: "Main" });
const railButton = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  useNavigationStore.getState().reset();
  useAuthStore.setState({ user: { id: "u1", username: "ada" }, token: "t" });
  usePrefsStore.setState({ userId: "u1", byUser: {}, legacyImported: true });
});

describe("AppShell", () => {
  it("leaves settings when any rail item is clicked (regression)", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(railButton("Settings"));
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();

    for (const name of ["Home", "DMs", "Groups", "Friends", "Archive"]) {
      await user.click(railButton("Settings"));
      await user.click(railButton(name));
      expect(screen.queryByRole("navigation", { name: "Settings sections" })).not.toBeInTheDocument();
      expect(railButton(name)).toHaveAttribute("aria-current", "page");
    }
    expect(rail()).toBeInTheDocument();
  });

  it("closes settings with Escape and returns to the previous page", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(railButton("Friends"));
    await user.click(railButton("Settings"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).not.toBeInTheDocument();
    expect(railButton("Friends")).toHaveAttribute("aria-current", "page");
  });

  it("opens settings with Ctrl+, and walks history with Alt+arrows", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(railButton("Groups"));
    await user.keyboard("{Control>},{/Control}");
    expect(useNavigationStore.getState().route.page).toBe("settings");
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(useNavigationStore.getState().route.page).toBe("groups");
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(useNavigationStore.getState().route.page).toBe("settings");
  });

  it("signs out from the account menu and resets session state", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(railButton("Groups"));
    await user.click(screen.getByRole("button", { name: "Account: ada" }));
    await user.click(await screen.findByRole("menuitem", { name: /Sign out/ }));

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(usePrefsStore.getState().userId).toBeNull();
    expect(useNavigationStore.getState().route).toEqual({ page: "home" });
    expect(useNavigationStore.getState().past).toEqual([]);
  });
});

describe("UpdateBanner", () => {
  it("stays hidden for quiet statuses", () => {
    const { container } = render(<UpdateBanner status={{ status: "not-available" }} isMac={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the platform's install action once downloaded, and can be dismissed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UpdateBanner status={{ status: "downloaded", version: "1.2.0" }} isMac />);
    expect(screen.getByText("Version 1.2.0 is ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download update" })).toBeInTheDocument();

    rerender(<UpdateBanner status={{ status: "downloaded", version: "1.2.0" }} isMac={false} />);
    expect(screen.getByRole("button", { name: "Restart and install" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces errors", () => {
    render(<UpdateBanner status={{ status: "error", message: "Signature mismatch" }} isMac={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Signature mismatch");
  });
});
