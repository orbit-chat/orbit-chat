import * as api from "../../lib/api";
import { generateSecretKey } from "../../lib/crypto";
import { KeyDistributionError, resolveMemberDevices, sealForDevices, type KeyRecipient } from "../../lib/conversationKeys";
import { refreshContactTrust, useContactTrustStore } from "../chat/contactTrust";
import { onContactDevicesRemoved } from "../../lib/deviceIdentity";
import { useAuthStore } from "../../stores/authStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { useConversationsStore, type Conversation } from "./conversationsStore";

/**
 * Per-device key operations that touch both the key cache and the conversation list (mobile plan
 * M1b): issuing a key version to every member's devices, rotating, and getting a key that's safe
 * to send with. With the server's switch off these aren't used; callers keep the legacy path.
 */

/** How many times a key write is re-sealed after the server says someone else got there first. */
const MAX_KEY_WRITE_ATTEMPTS = 4;

export function recipientsOf(conversation: Conversation): KeyRecipient[] {
  return conversation.members.map((m) => ({ userId: m.userId, username: m.user.username }));
}

/**
 * A fresh key for `keyVersion`, sealed and signed for every linked device of every recipient
 * (this user's own devices included).
 */
export async function sealNewKey(params: {
  conversationId: string;
  keyVersion: number;
  recipients: KeyRecipient[];
  myUserId: string;
  token: string;
}) {
  const me = await useE2EEStore.getState().thisDevice(params.myUserId, params.token);
  const devices = await resolveMemberDevices({ myUserId: params.myUserId, token: params.token, members: params.recipients });
  const secretKey = await generateSecretKey();
  const deviceKeys = await sealForDevices({
    conversationId: params.conversationId,
    keyVersion: params.keyVersion,
    secretKey,
    devices,
    signingPrivateKey: me.signingPrivateKey,
  });
  return { secretKey, deviceKeys };
}

function expectedVersionFrom(err: unknown): number | null {
  if (!(err instanceof api.ApiError) || err.code !== api.KEY_ERROR.versionConflict) return null;
  const expected = err.body.expectedKeyVersion;
  return typeof expected === "number" && Number.isInteger(expected) && expected >= 1 ? expected : null;
}

/** The latest copy of a conversation from the server, for when membership may have changed under us. */
async function refetchConversation(conversationId: string, token: string): Promise<Conversation | null> {
  const store = useConversationsStore.getState();
  await store.load(token);
  return useConversationsStore.getState().conversations.find((c) => c.id === conversationId) ?? null;
}

/**
 * Write one key version: seal for `recipients(conversation)` at the version the server expects,
 * re-sealing (the signatures cover the version) if another member rotated first, and once with
 * fresh membership and device lists if they changed while sealing. Returns what was issued.
 */
export async function writeKeyVersion(params: {
  conversation: Conversation;
  myUserId: string;
  token: string;
  recipients: (conversation: Conversation) => KeyRecipient[];
  send: (write: api.PerDeviceKeyWrite, conversation: Conversation) => Promise<unknown>;
}): Promise<{ keyVersion: number; secretKey: string }> {
  const { myUserId, token } = params;
  let conversation = params.conversation;
  const e2ee = useE2EEStore.getState();
  // Learn the newest version first; a stale guess just costs one 409.
  await e2ee.ensureConversationSecretKey({ conversation, token, myUserId });
  let keyVersion = (useE2EEStore.getState().getConversationKeyVersion(conversation.id) ?? 0) + 1;
  let refreshedMembership = false;

  for (let attempt = 1; ; attempt += 1) {
    const { secretKey, deviceKeys } = await sealNewKey({
      conversationId: conversation.id,
      keyVersion,
      recipients: params.recipients(conversation),
      myUserId,
      token,
    });
    try {
      await params.send({ keyVersion, deviceKeys }, conversation);
      useE2EEStore.getState().setConversationSecretKeyVersion({ conversationId: conversation.id, keyVersion, secretKey, sendable: true });
      return { keyVersion, secretKey };
    } catch (err) {
      if (attempt >= MAX_KEY_WRITE_ATTEMPTS) throw err;
      const expected = expectedVersionFrom(err);
      if (expected !== null) {
        // Someone issued the versions in between: fetch them, or their messages stay unreadable here.
        await useE2EEStore.getState().ensureConversationSecretKey({ conversation, token, myUserId, forceRefresh: true });
        keyVersion = expected;
        continue;
      }
      if (err instanceof api.ApiError && err.code === api.KEY_ERROR.deviceListChanged && !refreshedMembership) {
        refreshedMembership = true;
        const fresh = await refetchConversation(conversation.id, token);
        if (!fresh) throw err;
        conversation = fresh;
        continue;
      }
      throw err;
    }
  }
}

const rotationInFlight = new Map<string, Promise<{ keyVersion: number; secretKey: string }>>();

/** Issue the next key version to everyone in the conversation, and clear the server's "rotation required" flag locally. */
export function rotateConversationKey(params: { conversation: Conversation; myUserId: string; token: string }) {
  const id = params.conversation.id;
  const pending = rotationInFlight.get(id);
  if (pending) return pending;
  const run = writeKeyVersion({
    ...params,
    recipients: recipientsOf,
    send: (write, conversation) => api.rotateConversationKey(conversation.id, write, params.token),
  })
    .then((result) => {
      markRotated(id);
      return result;
    })
    .finally(() => rotationInFlight.delete(id));
  rotationInFlight.set(id, run);
  return run;
}

const MISSING_KEY_REFRESH_MS = 15_000;
const missingKeyRequestedAt = new Map<string, number>();

/**
 * A message needs a key version this device doesn't hold (issued while it was offline, skipped
 * over by a version conflict, or shared later by a linking device): refetch this conversation's
 * keys, at most every 15 seconds per conversation.
 */
export function requestMissingKey(conversationId: string, keyVersion: number | null | undefined) {
  const e2ee = useE2EEStore.getState();
  if (typeof keyVersion !== "number" || e2ee.getConversationSecretKeyForVersion(conversationId, keyVersion)) return;
  // Only for a chat this device has keys for. With none at all, the chat's own load (and its
  // error message) is what applies; refetching behind it would just hide that.
  if (!Object.keys(e2ee.secretKeyByConversationIdAndVersion[conversationId] ?? {}).length) return;
  const last = missingKeyRequestedAt.get(conversationId) ?? 0;
  if (Date.now() - last < MISSING_KEY_REFRESH_MS) return;
  const conversation = useConversationsStore.getState().conversations.find((c) => c.id === conversationId);
  const { token, user } = useAuthStore.getState();
  if (!conversation || !token || !user) return;
  missingKeyRequestedAt.set(conversationId, Date.now());
  void e2ee.ensureConversationSecretKey({ conversation, token, myUserId: user.id, forceRefresh: true });
}

// B8 backstop: when a contact's verified list loses a device (they revoked it), every chat shared
// with them rotates before this device's next send there, even if the server didn't flag it.
onContactDevicesRemoved((contactUserId) => {
  const store = useConversationsStore.getState();
  for (const conversation of store.conversations) {
    if (!conversation.rotationRequired && conversation.members.some((m) => m.userId === contactUserId)) {
      store.upsert({ ...conversation, rotationRequired: true });
    }
  }
});

/** Someone (this device or another member) rotated: the server has cleared its flag too. */
export function markRotated(conversationId: string) {
  const store = useConversationsStore.getState();
  const conversation = store.conversations.find((c) => c.id === conversationId);
  if (conversation?.rotationRequired) store.upsert({ ...conversation, rotationRequired: false });
}

/**
 * Refuses to send while any other member's identity key changed and this user hasn't reviewed it
 * (§4 decision 6). Lookups are cached for a minute per contact (`refreshContactTrust`).
 */
export async function assertNoUnreviewedIdentityChanges(conversation: Conversation, myUserId: string, token: string) {
  const others = conversation.members.filter((m) => m.userId !== myUserId);
  await Promise.all(others.map((m) => refreshContactTrust(m.userId, { me: { userId: myUserId, token } })));
  const trust = useContactTrustStore.getState().byUserId;
  const changed = others.find((m) => trust[m.userId]?.status === "identity-changed");
  if (changed) {
    throw new KeyDistributionError(
      `@${changed.user.username}'s security key changed. Review it before sending here.`,
      "identity-changed",
      changed.userId
    );
  }
}

/**
 * The key and version to encrypt a new message with. With per-device keys this rotates first
 * when the newest key isn't safe to send with: the server flagged the chat after a member left,
 * or this device's newest copy is missing, unsigned, or from a device or member that's gone.
 */
export async function ensureSendableKey(params: {
  conversation: Conversation;
  myUserId: string;
  token: string;
}): Promise<{ secretKey: string; keyVersion: number } | null> {
  const { conversation, myUserId, token } = params;
  const e2ee = useE2EEStore.getState();
  const key = await e2ee.ensureConversationSecretKey({ conversation, token, myUserId });
  if (!(await e2ee.ensureKeyMode(myUserId))) {
    return key ? { secretKey: key, keyVersion: useE2EEStore.getState().getConversationKeyVersion(conversation.id) ?? 1 } : null;
  }

  const latest = useConversationsStore.getState().conversations.find((c) => c.id === conversation.id) ?? conversation;
  // A key someone else issued may already reach a member's new, unreviewed identity (they
  // accepted it, this user hasn't): sending is paused for this user too until they review it (B6).
  await assertNoUnreviewedIdentityChanges(latest, myUserId, token);

  const state = useE2EEStore.getState();
  const keyVersion = state.keyVersionByConversationId[conversation.id];
  const secretKey = keyVersion ? state.secretKeyByConversationIdAndVersion[conversation.id]?.[keyVersion] : undefined;
  if (secretKey && keyVersion && state.sendableByConversationId[conversation.id] && !latest.rotationRequired) {
    return { secretKey, keyVersion };
  }
  return rotateConversationKey({ conversation: latest, myUserId, token });
}
