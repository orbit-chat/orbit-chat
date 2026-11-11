import * as api from "../../lib/api";
import { generateSecretKey, sealToPublicKey } from "../../lib/crypto";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { usePrefsStore } from "../../stores/prefsStore";
import { useConversationsStore, type Conversation } from "../conversations/conversationsStore";
import { latestPublicKey } from "../conversations/startDirectMessage";
import { usePasscodeRevealStore } from "../chat-settings/passcodeRevealStore";
import { recipientsOf, sealNewKey, writeKeyVersion } from "../conversations/conversationKeyOps";

type Me = { id: string };

/** Per-device keys (mobile plan M1b) or the legacy per-user form, as the server runs. */
function perDeviceKeys(me: Me) {
  return useE2EEStore.getState().ensureKeyMode(me.id);
}

const asRecipients = (people: Array<{ id: string; username: string }>) => people.map((p) => ({ userId: p.id, username: p.username }));

/**
 * Legacy keys only: seals `secretKey` to each member's newest device key. Fails with the
 * member's name if someone has no device key, since they could never read the conversation.
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
  const name = params.name.trim() || "New group";
  const memberIds = params.members.map((m) => m.id);

  let conversation: Conversation;
  if (await perDeviceKeys(me)) {
    // The ID is chosen here because every key envelope signs it.
    const conversationId = crypto.randomUUID();
    const { secretKey, deviceKeys } = await sealNewKey({
      conversationId,
      keyVersion: 1,
      recipients: asRecipients(params.members),
      myUserId: me.id,
      token
    });
    conversation = await api.createConversation({ type: "group", conversationId, keyVersion: 1, deviceKeys, name, memberIds }, token);
    useE2EEStore.getState().setConversationSecretKeyVersion({ conversationId: conversation.id, keyVersion: 1, secretKey, sendable: true });
  } else {
    const { publicKey: myPublicKey } = await useE2EEStore.getState().ensureDeviceKeypair(me.id, token);
    const secretKey = await generateSecretKey();
    const encryptedKeys = {
      [me.id]: await sealToPublicKey(secretKey, myPublicKey),
      ...(await sealForMembers({ secretKey, members: params.members, token }))
    };
    conversation = await api.createConversation({ type: "group", name, memberIds, encryptedKeys }, token);
  }

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
  const memberIds = params.members.map((m) => m.id);

  if (await perDeviceKeys(me)) {
    const added = asRecipients(params.members);
    await writeKeyVersion({
      conversation,
      myUserId: me.id,
      token,
      recipients: (current) => [...recipientsOf(current), ...added],
      send: (write, current) => api.addMembers(current.id, { memberIds, ...write }, token)
    });
  } else {
    const { publicKey: myPublicKey } = await useE2EEStore.getState().ensureDeviceKeypair(me.id, token);
    const existing = conversation.members.filter((m) => m.userId !== me.id).map((m) => ({ id: m.userId, username: m.user.username }));
    const everyone = [...existing, ...params.members.filter((p) => !existing.some((e) => e.id === p.id))];
    const secretKey = await generateSecretKey();
    const encryptedKeys = {
      [me.id]: await sealToPublicKey(secretKey, myPublicKey),
      ...(await sealForMembers({ secretKey, members: everyone, token }))
    };
    await api.addMembers(conversation.id, { memberIds, encryptedKeys }, token);
    adoptRotatedKey(conversation.id, secretKey);
  }
  // The server also broadcasts member_added; reloading keeps the list right if that's missed.
  await useConversationsStore.getState().load(token);
}

/** Owner only: remove someone and rotate the key so they can't read what comes next. */
export async function removeGroupMember(params: { conversation: Conversation; userId: string; me: Me; token: string }) {
  const { conversation, userId, me, token } = params;

  if (await perDeviceKeys(me)) {
    await writeKeyVersion({
      conversation,
      myUserId: me.id,
      token,
      recipients: (current) => recipientsOf(current).filter((r) => r.userId !== userId),
      send: (write, current) => api.removeMember(current.id, userId, write, token)
    });
  } else {
    const { publicKey: myPublicKey } = await useE2EEStore.getState().ensureDeviceKeypair(me.id, token);
    const remaining = conversation.members.filter((m) => m.userId !== me.id && m.userId !== userId).map((m) => ({ id: m.userId, username: m.user.username }));
    const secretKey = await generateSecretKey();
    const encryptedKeys = {
      [me.id]: await sealToPublicKey(secretKey, myPublicKey),
      ...(await sealForMembers({ secretKey, members: remaining, token }))
    };
    await api.removeMember(conversation.id, userId, { encryptedKeys }, token);
    adoptRotatedKey(conversation.id, secretKey);
  }
  useConversationsStore.getState().removeMember(conversation.id, userId);
}

/**
 * Leave a group. Legacy keys: the leaver seals a new key for those who remain (known limitation,
 * see docs/ui-rework-plan.md: the leaver generated that key). Per-device keys: the leaver can't
 * issue one (it's no longer a member), so the server flags the chat and the next remaining
 * member to send rotates first.
 */
export async function leaveGroup(params: { conversation: Conversation; wipeMessages: boolean; me: Me; token: string }) {
  const { conversation, me, token } = params;
  if (await perDeviceKeys(me)) {
    await api.leaveGroupChat(conversation.id, params.wipeMessages, token);
  } else {
    const remaining = conversation.members.filter((m) => m.userId !== me.id).map((m) => ({ id: m.userId, username: m.user.username }));
    const encryptedKeys = remaining.length ? await sealForMembers({ secretKey: await generateSecretKey(), members: remaining, token }) : undefined;
    await api.leaveGroupChat(conversation.id, params.wipeMessages, token, encryptedKeys);
  }
  forgetLocally(conversation.id);
}

/** Delete a DM for both people. The server also ends the friendship and erases its media. */
export async function deleteDirectMessage(params: { conversation: Conversation; token: string }) {
  await api.deleteConversation(params.conversation.id, true, params.token);
  forgetLocally(params.conversation.id);
}
