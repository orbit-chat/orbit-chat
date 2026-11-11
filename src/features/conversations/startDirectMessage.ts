import * as api from "../../lib/api";
import { generateSecretKey, sealToPublicKey } from "../../lib/crypto";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { usePrefsStore } from "../../stores/prefsStore";
import { useConversationsStore, type Conversation } from "./conversationsStore";
import { sealNewKey } from "./conversationKeyOps";

/** Newest registered device key for a user. */
export function latestPublicKey(keys: Array<{ publicKey: string; createdAt: string }>) {
  if (!keys.length) return null;
  return keys.reduce((newest, key) => (new Date(key.createdAt) > new Date(newest.createdAt) ? key : newest)).publicKey;
}

/**
 * Opens the existing DM with `target`, or creates one: a fresh conversation key is
 * sealed to both users' newest device keys before the server ever sees it.
 * Unlike the old client this throws on failure so the UI can say what went wrong.
 */
export async function startDirectMessage(params: {
  target: { id: string; username: string };
  me: { id: string };
  token: string;
}): Promise<Conversation> {
  const { target, me, token } = params;
  const conversations = useConversationsStore.getState();

  let conversation =
    conversations.conversations.find((c) => c.type === "dm" && c.members.some((m) => m.user.id === target.id)) ?? null;

  if (!conversation) {
    if (await useE2EEStore.getState().ensureKeyMode(me.id)) {
      // Per-device keys (mobile plan M1b): the ID is chosen here because every envelope signs it.
      const conversationId = crypto.randomUUID();
      const { secretKey, deviceKeys } = await sealNewKey({
        conversationId,
        keyVersion: 1,
        recipients: [{ userId: target.id, username: target.username }],
        myUserId: me.id,
        token
      });
      // The server returns the existing DM (created: false) if one already exists; its keys are then left alone.
      conversation = await api.createConversation({ type: "dm", conversationId, keyVersion: 1, deviceKeys, memberIds: [target.id] }, token);
      if (conversation.id === conversationId) {
        useE2EEStore.getState().setConversationSecretKeyVersion({ conversationId, keyVersion: 1, secretKey, sendable: true });
      }
    } else {
      const { publicKey: myPublicKey } = await useE2EEStore.getState().ensureDeviceKeypair(me.id, token);
      const theirPublicKey = latestPublicKey(await api.getUserKeys(target.id, token));
      if (!theirPublicKey) {
        throw new Error(`@${target.username} hasn't set up encryption on any device yet, so a secure chat can't be started.`);
      }
      const secretKey = await generateSecretKey();
      const encryptedKeys = {
        [me.id]: await sealToPublicKey(secretKey, myPublicKey),
        [target.id]: await sealToPublicKey(secretKey, theirPublicKey)
      };
      // The server returns the existing DM (created: false) if one already exists.
      conversation = await api.createConversation({ type: "dm", memberIds: [target.id], encryptedKeys }, token);
    }
    conversations.upsert(conversation);
  }

  // Opening a DM you started should bring it out of the archive.
  const prefs = usePrefsStore.getState();
  const userPrefs = prefs.userId ? prefs.byUser[prefs.userId] : undefined;
  if (userPrefs?.archivedConversationIds.includes(conversation.id)) prefs.toggleArchived(conversation.id);

  if (!conversation.passcodeEnabled) {
    useChatLockStore.getState().unlock(conversation.id, conversation.lockMode, conversation.lockTimeoutSeconds);
  }
  await useE2EEStore.getState().ensureConversationSecretKey({ conversation, token, myUserId: me.id });
  return conversation;
}
