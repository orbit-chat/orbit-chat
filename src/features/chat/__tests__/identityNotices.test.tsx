// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import sodium from "libsodium-wrappers-sumo";
import { generateSigningKeypair } from "../../../lib/deviceTrust";
import { dm } from "../../conversations/__tests__/fixtures";

/**
 * Identity notices in a chat (mobile plan B6/B10): a member whose key changed gets a warning and
 * nothing is sealed to them until the user reviews the safety number and accepts; a member who
 * added a device gets a dismissible notice.
 */

let contactState: { status: string; [key: string]: unknown } = { status: "no-identity" };
const acceptContactIdentity = vi.fn(async () => undefined);
vi.mock("../../../lib/deviceIdentity", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/deviceIdentity")>()),
  getContactDevices: async () => contactState,
  isContactVerified: async () => false,
  acceptContactIdentity: (...args: unknown[]) => (acceptContactIdentity as (...a: unknown[]) => Promise<void>)(...args),
  ownIdentityPublicKey: async () => ownIdentity.publicKey,
}));

let ownIdentity: { publicKey: string; privateKey: string };
const { IdentityNotices } = await import("../IdentityNotices");
const { useContactTrustStore } = await import("../contactTrust");
const { useAuthStore } = await import("../../../stores/authStore");
const { TooltipProvider } = await import("../../../ui");

const renderNotices = () =>
  render(
    <TooltipProvider>
      <IdentityNotices conversation={dm("c", "ada")} myUserId="me" />
    </TooltipProvider>
  );

beforeEach(async () => {
  await sodium.ready;
  ownIdentity = await generateSigningKeypair();
  acceptContactIdentity.mockClear();
  useContactTrustStore.getState().reset();
  useAuthStore.setState({ token: "t", user: { id: "me", username: "me" } });
});

describe("IdentityNotices", () => {
  it("warns about a changed key and accepts it only after review", async () => {
    const user = userEvent.setup();
    const current = await generateSigningKeypair();
    contactState = { status: "identity-changed", pinnedIdentityKey: "old", currentIdentityKey: current.publicKey };
    renderNotices();

    expect(await screen.findByText(/@ada's security key changed\. Nothing is sent to them/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review" }));
    // The new safety number is shown before anything can be accepted.
    await waitFor(() => expect(screen.getByLabelText(/^Safety number \d/)).toBeInTheDocument());
    contactState = { status: "verified", identityKey: current.publicKey, version: 1, devices: [], addedDevices: [], removedDeviceIds: [], firstSeen: false };
    await user.click(screen.getByRole("button", { name: "Accept new key" }));
    await waitFor(() => expect(acceptContactIdentity).toHaveBeenCalledWith("me", "ada", current.publicKey));
    await waitFor(() => expect(screen.queryByText(/security key changed/)).not.toBeInTheDocument());
  });

  it("tells you when someone added a device, until dismissed", async () => {
    const user = userEvent.setup();
    contactState = { status: "no-identity" };
    useContactTrustStore.getState().addNewDevices("ada", ["Orbit iOS"]);
    renderNotices();
    expect(await screen.findByText("@ada added a new device: Orbit iOS.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/added a new device/)).not.toBeInTheDocument();
  });
});
