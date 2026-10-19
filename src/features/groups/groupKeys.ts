import * as api from "../../lib/api";
import { generateSecretKey, sealToPublicKey } from "../../lib/crypto";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { usePrefsStore } from "../../stores/prefsStore";
import { useConversationsStore, type Conversation } from "../conversations/conversationsStore";
import { latestPublicKey } from "../conversations/startDirectMessage";
import { usePasscodeRevealStore } from "../chat-settings/passcodeRevealStore";

type Me = { id: string };

/**
 * Seals `secretKey` to each member's newest device key. Fails with the member's name if
 * someone has no device key, since they could never read the conversation.
 */
export async function sealForMembers(params: {
  secretKey: string;
  members: Array<{ id: string; username: string }>;
  token: string;
  known?: Record<string, string>;
}): Promise<Record<string, string>> {
  const sealed: Record<string, string> = {};
  for (const member of params.members) {
    const publicKey = params.known?.[member.id] ?? latestPublicKey(await api.getUserKeys(member.id, params.token));
    if (!publicKey) throw new Error(`@${member.username} hasn't set up encryption on any device yet.`);
    sealed[member.id] = await sealToPublicKey(params.secretKey, publicKey);
  }
  return sealed;
}

/** Forget a conversation everywhere after you've deleted or left it. */
function forgetLocally(conversationId: string) {
  useConversationsStore.getState().remove(conversationId);
  useNavigationStore.getState().forgetConversation(conversationId);
  usePrefsStore.getState().forgetConversation(conversationId);
  useChatLockStore.getState().lock(conversationId);
}

/** Record a key rotation we performed, so our next message uses the new version straight away. */
function adoptRotatedKey(conversationId: string, secretKey: string) {
  const e2ee = useE2EEStore.getState();
  e2ee.setConversationSecretKeyVersion({ conversationId, keyVersion: (e2ee.getConversationKeyVersion(conversationId) ?? 1) + 1, secretKey });
}

/** Create a group with a fresh key sealed to you and every member. */
export async function createGroup(params: { name: string; members: Array<{ id: string; username: string }>; me: Me; token: string }): Promise<Conversation> {
  const { me, token } = params;
  if (!params.members.length) throw new Error("Pick at least one person.");
  const { publicKey: myPublicKey } = await useE2EEStore.getState().ensureDeviceKeypair(me.id, token);
  const secretKey = await generateSecretKey();
  const encryptedKeys = {
    [me.id]: await sealToPublicKey(secretKey, myPublicKey),
    ...(await sealForMembers({ secretKey, members: params.members, token }))
  };
  const conversation = await api.createConversation(
    { type: "group", name: params.name.trim() || "New group", memberIds: params.members.map((m) => m.id), encryptedKeys },
    token
  );
  useConversationsStore.getState().upsert(conversation);
  if (conversation.passcode) {
    usePasscodeRevealStore.getState().show({ conversationId: conversation.id, passcode: conversation.passcode, label: conversation.name ?? "New group" });
  } else {
    useChatLockStore.getState().unlock(conversation.id, conversation.lockMode, conversation.lockTimeoutSeconds);
  }
  await useE2EEStore.getState().ensureConversationSecretKey({ conversation, token, myUserId: me.id });
  return conversation;
}

/**
 * Add people to a group. The key rotates for the new membership, so the newcomers get a
 * key only for messages from now on.
 */
export async function addGroupMembers(params: { conversation: Conversation; members: Array<{ id: string; username: string }>; me: Me; token: string }) {
  const { conversation, me, token } = params;
  if (!params.members.length) throw new Error("Pick at least one person.");
  const { publicKey: myPublicKey } = await useE2EEStore.getState().ensureDeviceKeypair(me.id, token);
  const existing = conversation.members.filter((m) => m.userId !== me.id).map((m) => ({ id: m.userId, username: m.user.username }));
  const everyone = [...existing, ...params.members.filter((p) => !existing.some((e) => e.id === p.id))];
  const secretKey = await generateSecretKey();
  const encryptedKeys = {
    [me.id]: await sealToPublicKey(secretKey, myPublicKey),
    ...(await sealForMembers({ secretKey, members: everyone, token }))
  };
  await api.addMembers(conversation.id, { memberIds: params.members.map((m) => m.id), encryptedKeys }, token);
  adoptRotatedKey(conversation.id, secretKey);
  // The server also broadcasts member_added; reloading keeps the list right if that's missed.
  await useConversationsStore.getState().load(token);
}

/** Owner only: remove someone and rotate the key so they can't read what comes next. */
export async function removeGroupMember(params: { conversation: Conversation; userId: string; me: Me; token: string }) {
  const { conversation, userId, me, token } = params;
  const { publicKey: myPublicKey } = await useE2EEStore.getState().ensureDeviceKeypair(me.id, token);
  const remaining = conversation.members.filter((m) => m.userId !== me.id && m.userId !== userId).map((m) => ({ id: m.userId, username: m.user.username }));
  const secretKey = await generateSecretKey();
  const encryptedKeys = {
    [me.id]: await sealToPublicKey(secretKey, myPublicKey),
    ...(await sealForMembers({ secretKey, members: remaining, token }))
  };
  await api.removeMember(conversation.id, userId, encryptedKeys, token);
  adoptRotatedKey(conversation.id, secretKey);
  useConversationsStore.getState().removeMember(conversation.id, userId);
}

/**
 * Leave a group. Same protocol as the old client: the leaver seals a new key for those who
 * remain. Known limitation (see docs/ui-rework-plan.md): the leaver generated that key.
 */
export async function leaveGroup(params: { conversation: Conversation; wipeMessages: boolean; me: Me; token: string }) {
  const { conversation, me, token } = params;
  const remaining = conversation.members.filter((m) => m.userId !== me.id).map((m) => ({ id: m.userId, username: m.user.username }));
  const encryptedKeys = remaining.length ? await sealForMembers({ secretKey: await generateSecretKey(), members: remaining, token }) : undefined;
  await api.leaveGroupChat(conversation.id, params.wipeMessages, token, encryptedKeys);
  forgetLocally(conversation.id);
}

/** Delete a DM for both people. The server also ends the friendship and erases its media. */
export async function deleteDirectMessage(params: { conversation: Conversation; token: string }) {
  await api.deleteConversation(params.conversation.id, true, params.token);
  forgetLocally(params.conversation.id);
}
