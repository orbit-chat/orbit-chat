// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, openSealedWithKeypair } from "../../../lib/crypto";
import { dm, group } from "../../conversations/__tests__/fixtures";

const api = {
  getUserKeys: vi.fn(),
  createConversation: vi.fn(),
  addMembers: vi.fn(),
  removeMember: vi.fn(),
  leaveGroupChat: vi.fn(),
  deleteConversation: vi.fn(),
  getConversations: vi.fn()
};
vi.mock("../../../lib/api", async (importActual) => ({
  ...(await importActual<typeof import("../../../lib/api")>()),
  ...Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]))
}));

const { createGroup, addGroupMembers, removeGroupMember, leaveGroup, deleteDirectMessage } = await import("../groupKeys");
const { validateLockSettings } = await import("../../chat-settings/ChatSettingsDialog");
const { useConversationsStore } = await import("../../conversations/conversationsStore");
const { useE2EEStore } = await import("../../../stores/e2eeStore");
const { usePrefsStore } = await import("../../../stores/prefsStore");
const { useNavigationStore } = await import("../../../stores/navigationStore");
const { useChatLockStore } = await import("../../../stores/chatLockStore");
const { usePasscodeRevealStore } = await import("../../chat-settings/passcodeRevealStore");

const keys: Record<string, { publicKey: string; privateKey: string }> = {};
for (const id of ["me", "ada", "bob", "cy"]) keys[id] = await generateKeypair();
const me = { id: "me" };
const setVersion = vi.fn();

/** Opens a sealed key for `userId` with their real private key. */
const open = (sealed: string, userId: string) => openSealedWithKeypair(sealed, keys[userId]!.publicKey, keys[userId]!.privateKey);

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getUserKeys.mockImplementation(async (id: string) => (keys[id] ? [{ publicKey: keys[id]!.publicKey, createdAt: "2026-01-01" }] : []));
  api.getConversations.mockResolvedValue([]);
  setVersion.mockReset();
  useConversationsStore.getState().reset();
  usePasscodeRevealStore.setState({ current: null });
  useChatLockStore.setState({ unlocked: {} });
  useNavigationStore.getState().reset();
  usePrefsStore.setState({ userId: "me", byUser: {}, legacyImported: true });
  usePrefsStore.getState().activate("me");
  useE2EEStore.setState({
    ensureDeviceKeypair: vi.fn(async () => keys.me!),
    ensureConversationSecretKey: vi.fn(async () => "k"),
    getConversationKeyVersion: () => 2,
    setConversationSecretKeyVersion: setVersion
  });
});

describe("createGroup", () => {
  it("seals one fresh key to me and every member", async () => {
    api.createConversation.mockResolvedValue(group("g", ["ada", "bob"], { name: "Crew" }));
    await createGroup({ name: "  Crew ", members: [{ id: "ada", username: "ada" }, { id: "bob", username: "bob" }], me, token: "t" });
    const body = api.createConversation.mock.calls[0]![0];
    expect(body).toMatchObject({ type: "group", name: "Crew", memberIds: ["ada", "bob"] });
    const opened = await Promise.all(["me", "ada", "bob"].map((id) => open(body.encryptedKeys[id], id)));
    expect(new Set(opened).size).toBe(1);
    expect(useConversationsStore.getState().conversations[0]!.id).toBe("g");
    expect(useChatLockStore.getState().unlocked.g).toBeDefined();
  });

  it("shows a returned passcode instead of unlocking", async () => {
    api.createConversation.mockResolvedValue({ ...group("g", ["ada"], { name: "Crew", passcodeEnabled: true }), passcode: "4821" });
    await createGroup({ name: "Crew", members: [{ id: "ada", username: "ada" }], me, token: "t" });
    expect(usePasscodeRevealStore.getState().current).toEqual({ conversationId: "g", passcode: "4821", label: "Crew" });
    expect(useChatLockStore.getState().unlocked.g).toBeUndefined();
  });

  it("names a member who can't receive keys and creates nothing", async () => {
    await expect(createGroup({ name: "", members: [{ id: "ghost", username: "ghost" }], me, token: "t" })).rejects.toThrow("@ghost hasn't set up encryption");
    await expect(createGroup({ name: "", members: [], me, token: "t" })).rejects.toThrow("Pick at least one person.");
    expect(api.createConversation).not.toHaveBeenCalled();
  });
});

describe("membership changes rotate the key", () => {
  it("adds people with a new key for everyone and adopts the next version locally", async () => {
    const conversation = group("g", ["ada"]);
    await addGroupMembers({ conversation, members: [{ id: "bob", username: "bob" }], me, token: "t" });
    const [id, body] = api.addMembers.mock.calls[0]!;
    expect(id).toBe("g");
    expect(body.memberIds).toEqual(["bob"]);
    expect(Object.keys(body.encryptedKeys).sort()).toEqual(["ada", "bob", "me"]);
    const secret = await open(body.encryptedKeys.bob, "bob");
    expect(await open(body.encryptedKeys.ada, "ada")).toBe(secret);
    expect(setVersion).toHaveBeenCalledWith({ conversationId: "g", keyVersion: 3, secretKey: secret });
  });

  it("removes someone with a key they can't open", async () => {
    const conversation = group("g", ["ada", "bob"], { createdBy: "me" });
    useConversationsStore.getState().upsert(conversation);
    await removeGroupMember({ conversation, userId: "bob", me, token: "t" });
    const [, userId, encryptedKeys] = api.removeMember.mock.calls[0]!;
    expect(userId).toBe("bob");
    expect(Object.keys(encryptedKeys).sort()).toEqual(["ada", "me"]);
    expect(useConversationsStore.getState().conversations[0]!.members.map((m) => m.userId)).toEqual(["me", "ada"]);
  });
});

describe("leaving and deleting", () => {
  it("leaves a group and forgets it everywhere", async () => {
    const conversation = group("g", ["ada"]);
    useConversationsStore.getState().upsert(conversation);
    usePrefsStore.getState().togglePinned("g");
    useNavigationStore.getState().openConversation({ id: "g", type: "group" });
    await leaveGroup({ conversation, wipeMessages: false, me, token: "t" });
    expect(api.leaveGroupChat.mock.calls[0]!.slice(0, 3)).toEqual(["g", false, "t"]);
    expect(Object.keys(api.leaveGroupChat.mock.calls[0]![3])).toEqual(["ada"]);
    expect(useConversationsStore.getState().conversations).toEqual([]);
    expect(useNavigationStore.getState().route).toEqual({ page: "groups", conversationId: null });
    expect(usePrefsStore.getState().byUser.me!.pinnedConversationIds).toEqual([]);
  });

  it("sends no keys when the last member leaves", async () => {
    await leaveGroup({ conversation: group("g", []), wipeMessages: true, me, token: "t" });
    expect(api.leaveGroupChat).toHaveBeenCalledWith("g", true, "t", undefined);
  });

  it("deletes a DM for both people", async () => {
    const conversation = dm("d", "ada");
    useConversationsStore.getState().upsert(conversation);
    await deleteDirectMessage({ conversation, token: "t" });
    expect(api.deleteConversation).toHaveBeenCalledWith("d", true, "t");
    expect(useConversationsStore.getState().conversations).toEqual([]);
  });
});

describe("validateLockSettings", () => {
  const base = { passcodeEnabled: true, originalLength: 4, length: 4, passcode: "", lockMode: "on_leave" as const, timeout: 300 };
  it("checks passcode length and timeouts", () => {
    expect(validateLockSettings(base)).toBeNull();
    expect(validateLockSettings({ ...base, passcode: "12" })).toBe("The new passcode must be 4 digits.");
    expect(validateLockSettings({ ...base, length: 6 })).toBe("Enter a new 6-digit passcode to change its length.");
    expect(validateLockSettings({ ...base, length: 6, passcode: "123456" })).toBeNull();
    expect(validateLockSettings({ ...base, lockMode: "after_time", timeout: 5 })).toBe("The lock timeout must be at least 10 seconds.");
    expect(validateLockSettings({ ...base, passcodeEnabled: false, length: 6 })).toBeNull();
  });
});
