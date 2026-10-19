// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthScreen } from "../AuthScreen";
import { RecoveryCodesScreen } from "../RecoveryCodesScreen";
import { useAuthStore } from "../../../stores/authStore";

const login = vi.fn(async () => {});
const signup = vi.fn(async () => {});
const loginWithRecoveryCode = vi.fn(async () => {});

beforeEach(() => {
  login.mockClear();
  signup.mockClear();
  loginWithRecoveryCode.mockClear();
  useAuthStore.setState({ login, signup, loginWithRecoveryCode, loading: false, error: null, pendingRecoveryCodes: null });
});

describe("AuthScreen", () => {
  it("validates before calling the server", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Username is required.")).toBeInTheDocument();
    expect(screen.getByText("Password is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
    expect(login).not.toHaveBeenCalled();
  });

  it("signs in with a trimmed username", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.type(screen.getByLabelText("Username"), "  ada ");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(login).toHaveBeenCalledWith("ada", "secret");
  });

  it("keeps the username but not the password when switching tabs", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.type(screen.getByLabelText("Username"), "ada");
    await user.type(screen.getByLabelText("Password"), "secret");

    await user.click(screen.getByRole("tab", { name: "Create account" }));
    expect(screen.getByLabelText("Username")).toHaveValue("ada");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("shows password requirements live and blocks weak or mismatched signups", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole("tab", { name: "Create account" }));
    await user.type(screen.getByLabelText("Username"), "ada");
    await user.type(screen.getByLabelText("Password"), "longenough");

    const rules = within(screen.getByRole("list", { name: "Password requirements" }));
    expect(rules.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Met: At least 8 characters",
      "Not met: A number",
      "Not met: A special character"
    ]);

    await user.type(screen.getByLabelText("Password"), "1!");
    await user.type(screen.getByLabelText("Confirm password"), "different1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Confirm password"));
    await user.type(screen.getByLabelText("Confirm password"), "longenough1!");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(signup).toHaveBeenCalledWith("ada", "longenough1!");
  });

  it("signs in with a recovery code", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole("tab", { name: "Recovery" }));
    await user.type(screen.getByLabelText("Username"), "ada");
    await user.type(screen.getByLabelText("Recovery code"), " abcd-efgh ");
    await user.click(screen.getByRole("button", { name: "Sign in with recovery code" }));
    expect(loginWithRecoveryCode).toHaveBeenCalledWith("ada", "abcd-efgh");
  });

  it("shows the server error and clears it when switching tabs", async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ error: "Invalid credentials" });
    render(<AuthScreen />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
    await user.click(screen.getByRole("tab", { name: "Recovery" }));
    expect(screen.queryByText("Invalid credentials")).not.toBeInTheDocument();
  });

  it("disables the submit button while a request is in flight", () => {
    useAuthStore.setState({ loading: true });
    render(<AuthScreen />);
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
  });
});

describe("RecoveryCodesScreen", () => {
  it("only continues once the user confirms they saved the codes", async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ pendingRecoveryCodes: ["aaaa-1111", "bbbb-2222"] });
    render(<RecoveryCodesScreen codes={["aaaa-1111", "bbbb-2222"]} />);

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["aaaa-1111", "bbbb-2222"]);
    const continueButton = screen.getByRole("button", { name: "Continue to Orbit" });
    expect(continueButton).toBeDisabled();

    await user.click(screen.getByLabelText("I've stored these codes somewhere safe."));
    await user.click(continueButton);
    expect(useAuthStore.getState().pendingRecoveryCodes).toBeNull();
  });
});
