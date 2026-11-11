// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadLinkProps, externalLinkProps, getPlatform, isMobile, setPlatform } from "..";

afterEach(() => {
  setPlatform(null);
  vi.restoreAllMocks();
});

const click = (overrides: Partial<{ button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => {
  const event = { preventDefault: vi.fn(), button: 0, ctrlKey: false, metaKey: false, shiftKey: false, ...overrides };
  return event;
};

describe("platform selection", () => {
  it("defaults to the web implementation outside Electron", () => {
    const platform = getPlatform();
    expect(platform.kind).toBe("web");
    expect(platform.updater).toBeUndefined();
    expect(platform.scanQrCode).toBeUndefined();
    expect(isMobile()).toBe(false);
  });

  it("lets a shell override only what differs and keeps the rest", () => {
    const openExternal = vi.fn();
    setPlatform({ kind: "ios", deviceName: "Orbit iOS", openExternal });
    const platform = getPlatform();
    expect(platform.kind).toBe("ios");
    expect(platform.openExternal).toBe(openExternal);
    expect(typeof platform.clipboard.writeText).toBe("function");
    expect(isMobile()).toBe(true);
  });

  it("resets to the detected platform with null", () => {
    setPlatform({ kind: "android" });
    setPlatform(null);
    expect(getPlatform().kind).toBe("web");
  });
});

describe("externalLinkProps", () => {
  it("opens links through the platform, never by navigating the app", () => {
    const openExternal = vi.fn();
    setPlatform({ openExternal });
    const props = externalLinkProps("https://example.com/a");
    const event = click();
    props.onClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/a");
    expect(props).toMatchObject({ href: "https://example.com/a", target: "_blank", rel: "noreferrer noopener" });
  });
});

describe("downloadLinkProps", () => {
  it("saves through the platform on a plain click", () => {
    const saveFile = vi.fn(async () => {});
    setPlatform({ saveFile });
    const event = click();
    downloadLinkProps("photo.png", "blob:abc").onClick(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(saveFile).toHaveBeenCalledWith("photo.png", "blob:abc");
  });

  it("does nothing while the file is still decrypting", () => {
    const saveFile = vi.fn(async () => {});
    setPlatform({ saveFile });
    const event = click();
    const props = downloadLinkProps("photo.png", null);
    props.onClick(event);
    expect(props.href).toBeUndefined();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("leaves modified clicks to the browser", () => {
    const saveFile = vi.fn(async () => {});
    setPlatform({ saveFile });
    downloadLinkProps("photo.png", "blob:abc").onClick(click({ ctrlKey: true }));
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("swallows a failed save instead of leaving an unhandled rejection", async () => {
    const saveFile = vi.fn(async () => {
      throw new Error("denied");
    });
    setPlatform({ saveFile });
    downloadLinkProps("photo.png", "blob:abc").onClick(click());
    await Promise.resolve();
    expect(saveFile).toHaveBeenCalled();
  });
});

describe("browser notifications", () => {
  it("reports denied where the Notification API is missing", async () => {
    expect("Notification" in window).toBe(false);
    const { notifications } = getPlatform();
    expect(notifications.supported()).toBe(false);
    await expect(notifications.permission()).resolves.toBe("denied");
    expect(() => notifications.show({ title: "t", body: "b", tag: "c" })).not.toThrow();
  });
});

describe("browser clipboard", () => {
  it("rejects when the clipboard API is unavailable so callers can show it", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await expect(getPlatform().clipboard.writeText("x")).rejects.toThrow();
  });
});
