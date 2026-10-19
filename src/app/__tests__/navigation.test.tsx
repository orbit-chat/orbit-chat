// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "../../ui";
import { DevGallery } from "../dev/DevGallery";
import { useNavigationStore } from "../../stores/navigationStore";

describe("rail navigation (regression: settings stayed open until Close was clicked)", () => {
  beforeEach(() => useNavigationStore.getState().reset());

  it("replaces the settings page when another rail item is clicked", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <DevGallery />
      </TooltipProvider>
    );
    const rail = screen.getByRole("navigation", { name: "Main" });
    const railButton = (name: string) => [...rail.querySelectorAll("button")].find((b) => b.textContent === name)!;

    await user.click(railButton("Settings"));
    expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeInTheDocument();
    expect(railButton("Settings")).toHaveAttribute("aria-current", "page");

    await user.click(railButton("Friends"));
    expect(screen.queryByRole("navigation", { name: "Settings sections" })).not.toBeInTheDocument();
    expect(railButton("Friends")).toHaveAttribute("aria-current", "page");
    expect(railButton("Settings")).not.toHaveAttribute("aria-current");
  });
});
