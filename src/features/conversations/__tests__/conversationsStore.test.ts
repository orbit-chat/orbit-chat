import { beforeEach, describe, expect, it, vi } from "vitest";
import { dm, group } from "./fixtures";

const getConversations = vi.fn();
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  getConversations: (...args: unknown[]) => getConversations(...args)
}));

const { useConversationsStore } = await import("../conversationsStore");
const store = () => useConversationsStore.getState();

describe("conversationsStore", () => {
  beforeEach(() => {
    store().reset();
    getConversations.mockReset();
  });

  it("loads the list", async () => {
    getConversations.mockResolvedValue([dm("a", "ada")]);
    await store().load("t");
    expect(store().status).toBe("ready");
    expect(store().conversations.map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps the current list when a reload fails", async () => {
    getConversations.mockResolvedValueOnce([dm("a", "ada")]).mockRejectedValueOnce(new Error("offline"));
    await store().load("t");
    await store().load("t");
    expect(store().status).toBe("ready");
    expect(store().error).toBe("offline");
    expect(store().conversations).toHaveLength(1);
  });

  it("reports an error when the first load fails", async () => {
    getConversations.mockRejectedValue(new Error("offline"));
    await store().load("t");
    expect(store().status).toBe("error");
  });

  it("ignores a load that finishes after sign-out", async () => {
    let resolve!: (value: unknown) => void;
    getConversations.mockReturnValue(new Promise((r) => (resolve = r)));
    const pending = store().load("t");
    store().reset();
    resolve([dm("a", "ada")]);
    await pending;
    expect(store().conversations).toEqual([]);
    expect(store().status).toBe("idle");
  });

  it("upserts new conversations first and replaces existing ones in place", () => {
    store().upsert(dm("a", "ada"));
    store().upsert(group("g", ["x"]));
    store().upsert(dm("a", "ada", { name: "Renamed" }));
    expect(store().conversations.map((c) => [c.id, c.name])).toEqual([
      ["g", null],
      ["a", "Renamed"]
    ]);
  });

  it("removes members and conversations, and hands out pending passcodes once", () => {
    store().upsert(group("g", ["ada", "bob"]));
    store().removeMember("g", "bob");
    expect(store().conversations[0]!.members.map((m) => m.userId)).toEqual(["me", "ada"]);

    store().setPendingPasscode("g", { passcode: "1234", label: "G" });
    expect(store().takePendingPasscode("g")).toEqual({ passcode: "1234", label: "G" });
    expect(store().takePendingPasscode("g")).toBeNull();

    store().setPendingPasscode("g", { passcode: "9", label: "G" });
    store().remove("g");
    expect(store().conversations).toEqual([]);
    expect(store().pendingPasscodes).toEqual({});
  });
});
