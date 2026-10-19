// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, openSealedWithKeypair } from "../../../lib/crypto";
import { ME, dm } from "./fixtures";

const getUserKeys = vi.fn();
const createConversation = vi.fn();
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  getUserKeys: (...args: unknown[]) => getUserKeys(...args),
  createConversation: (...args: unknown[]) => createConversation(...args)
}));

const { startDirectMessage, latestPublicKey } = await import("../startDirectMessage");
const { useConversationsStore } = await import("../conversationsStore");
const { useE2EEStore } = await import("../../../stores/e2eeStore");
const { usePrefsStore } = await import("../../../stores/prefsStore");
const { useChatLockStore } = await import("../../../stores/chatLockStore");

const mine = await generateKeypair();
const theirs = await generateKeypair();
const ensureConversationSecretKey = vi.fn(async () => "key");

beforeEach(() => {
  getUserKeys.mockReset();
  createConversation.mockReset();
  ensureConversationSecretKey.mockClear();
  useConversationsStore.getState().reset();
  useE2EEStore.setState({
    ensureDeviceKeypair: vi.fn(async () => mine),
    ensureConversationSecretKey
  });
  usePrefsStore.setState({ userId: ME.id, byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate(ME.id);
  useChatLockStore.setState({ unlocked: {} });
});

describe("startDirectMessage", () => {
  it("reuses an existing DM without calling the server, and brings it out of the archive", async () => {
    useConversationsStore.getState().upsert(dm("existing", "ada"));
    usePrefsStore.getState().toggleArchived("existing");

    const result = await startDirectMessage({ target: { id: "ada", username: "ada" }, me: ME, token: "t" });

    expect(result.id).toBe("existing");
    expect(createConversation).not.toHaveBeenCalled();
    expect(usePrefsStore.getState().byUser[ME.id]!.archivedConversationIds).toEqual([]);
    expect(useChatLockStore.getState().unlocked.existing).toBeDefined();
    expect(ensureConversationSecretKey).toHaveBeenCalled();
  });

  it("creates a DM with a fresh key sealed to both users' newest device keys", async () => {
    getUserKeys.mockResolvedValue([
      { publicKey: "stale-key", createdAt: "2025-01-01T00:00:00Z" },
      { publicKey: theirs.publicKey, createdAt: "2026-01-01T00:00:00Z" }
    ]);
    createConversation.mockResolvedValue(dm("new", "ada", { created: true }));

    const result = await startDirectMessage({ target: { id: "ada", username: "ada" }, me: ME, token: "t" });

    expect(result.id).toBe("new");
    const body = createConversation.mock.calls[0]![0] as { type: string; memberIds: string[]; encryptedKeys: Record<string, string> };
    expect(body.type).toBe("dm");
    expect(body.memberIds).toEqual(["ada"]);
    const mineOpened = await openSealedWithKeypair(body.encryptedKeys[ME.id]!, mine.publicKey, mine.privateKey);
    const theirsOpened = await openSealedWithKeypair(body.encryptedKeys.ada!, theirs.publicKey, theirs.privateKey);
    expect(mineOpened).toBe(theirsOpened);
    expect(useConversationsStore.getState().conversations.map((c) => c.id)).toEqual(["new"]);
  });

  it("explains when the other user has no device keys", async () => {
    getUserKeys.mockResolvedValue([]);
    await expect(startDirectMessage({ target: { id: "ada", username: "ada" }, me: ME, token: "t" })).rejects.toThrow(
      "@ada hasn't set up encryption"
    );
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("keeps passcode-protected DMs locked", async () => {
    useConversationsStore.getState().upsert(dm("locked", "ada", { passcodeEnabled: true }));
    await startDirectMessage({ target: { id: "ada", username: "ada" }, me: ME, token: "t" });
    expect(useChatLockStore.getState().unlocked.locked).toBeUndefined();
  });
});

it("latestPublicKey picks the newest key", () => {
  expect(latestPublicKey([])).toBeNull();
  expect(
    latestPublicKey([
      { publicKey: "b", createdAt: "2026-02-01" },
      { publicKey: "c", createdAt: "2026-03-01" },
      { publicKey: "a", createdAt: "2026-01-01" }
    ])
  ).toBe("c");
});
