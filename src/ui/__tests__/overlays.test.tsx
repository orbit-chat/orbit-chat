// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Button, Dialog, DialogContent, DialogTrigger, Popover, PopoverContent, PopoverTrigger } from "..";

describe("Popover (regression: pinned popover trapped under a backdrop-blur header)", () => {
  it("renders its content outside the trigger's ancestors, directly under <body>", async () => {
    render(
      <>
        <header data-testid="header" className="backdrop-blur">
          <Popover>
            <PopoverTrigger asChild>
              <Button>Pins</Button>
            </PopoverTrigger>
            <PopoverContent>Pinned list</PopoverContent>
          </Popover>
        </header>
        <section data-testid="messages">messages</section>
      </>
    );

    await userEvent.click(screen.getByRole("button", { name: "Pins" }));
    const content = await screen.findByText("Pinned list");

    // Inside the header it would share the header's stacking context and the later
    // message list would paint over it and steal its hover events.
    expect(screen.getByTestId("header")).not.toContainElement(content);
    const portalRoot = [...document.body.children].find((child) => child.contains(content));
    expect(portalRoot).toBeDefined();
    expect(portalRoot).not.toContainElement(screen.getByTestId("messages"));
  });

  it("closes on Escape and on outside click", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Popover>
          <PopoverTrigger asChild>
            <Button>Pins</Button>
          </PopoverTrigger>
          <PopoverContent>Pinned list</PopoverContent>
        </Popover>
        <p>elsewhere</p>
      </>
    );

    await user.click(screen.getByRole("button", { name: "Pins" }));
    expect(await screen.findByText("Pinned list")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Pinned list")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pins" }));
    expect(await screen.findByText("Pinned list")).toBeInTheDocument();
    await user.click(screen.getByText("elsewhere"));
    expect(screen.queryByText("Pinned list")).not.toBeInTheDocument();
  });
});

function DialogHarness({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main data-testid="app">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Open</Button>
          </DialogTrigger>
          <DialogContent title="Leave group" dismissible={dismissible} footer={<Button>Confirm</Button>}>
            <input aria-label="Reason" />
          </DialogContent>
        </Dialog>
      </main>
    </>
  );
}

describe("Dialog", () => {
  it("moves focus inside, hides the app from assistive tech, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog", { name: "Leave group" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    // Radix hides every top-level sibling of the portal, i.e. the root the app is mounted in.
    expect(screen.getByTestId("app").closest("body > *")).toHaveAttribute("aria-hidden", "true");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });

  it("keeps focus trapped while tabbing", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");

    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("ignores Escape while not dismissible", async () => {
    const user = userEvent.setup();
    render(<DialogHarness dismissible={false} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
