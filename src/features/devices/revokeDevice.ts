import * as api from "../../lib/api";
import { devLog } from "../../lib/devLogger";
import {
  deviceSigningKeyStorageKey,
  identityKeyStorageKey,
  ownListVersionStorageKey,
  pinsStorageKey,
  publishDeviceListChange,
} from "../../lib/deviceIdentity";
import { deviceIdFromToken } from "../../lib/jwt";
import { getPlatform } from "../../platform";
import { devicePrivateKeyStorageKey, legacyKeysMovedStorageKey, useE2EEStore } from "../../stores/e2eeStore";
import { rotateConversationKey } from "../conversations/conversationKeyOps";
import { useConversationsStore } from "../conversations/conversationsStore";

/**
 * Removing a device (mobile plan B8). Publishing a list without it is the revoke: the server then
 * ends its session, drops its key copies, closes its sockets and flags every chat for a new key,
 * so nothing new is ever sealed to keys it holds. This device also rotates its chats right away,
 * so the next message anyone sends doesn't wait on that.
 */

/** Secrets and per-device records this install keeps for a user; all go when it forgets itself. */
function localDeviceKeys(userId: string) {
  return [
    devicePrivateKeyStorageKey(userId),
    deviceSigningKeyStorageKey(userId),
    identityKeyStorageKey(userId),
    ownListVersionStorageKey(userId),
    pinsStorageKey(userId),
    legacyKeysMovedStorageKey(userId),
    `orbit:historyShares:${userId}`,
  ];
}

/** Wipe this device's keys for the user. Its next sign-in is a new, unlinked device. */
export async function forgetThisDevice(userId: string) {
  const store = getPlatform().secureStore;
  for (const key of localDeviceKeys(userId)) await store.remove(key);
  useE2EEStore.getState().reset();
}

/** Issue a new key in every chat (best effort; the server's flag covers any that fail). */
export async function rotateAllConversations(userId: string, token: string) {
  for (const conversation of useConversationsStore.getState().conversations) {
    try {
      await rotateConversationKey({ conversation, myUserId: userId, token });
    } catch (err) {
      devLog.warn(`Rotating ${conversation.id} after a revoke failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Remove a linked device from the account. Removing this device is "sign out and forget this
 * device": its keys are wiped once the list no longer names it; the caller then signs out.
 */
export async function removeLinkedDevice(params: { userId: string; token: string; deviceId: string }) {
  const { userId, token, deviceId } = params;
  const thisDeviceId = deviceIdFromToken(token);
  await publishDeviceListChange(userId, token, (current) => {
    const remaining = current.devices.filter((d) => d.deviceId !== deviceId);
    if (remaining.length === current.devices.length) throw new Error("That device isn't linked to your account.");
    if (!remaining.length) {
      throw new Error("This is your only linked device. Link another one first, or just sign out.");
    }
    return remaining;
  });
  if (deviceId === thisDeviceId) {
    await forgetThisDevice(userId);
    return { forgotThisDevice: true };
  }
  void rotateAllConversations(userId, token);
  return { forgotThisDevice: false };
}

/** Sign out a device that signed in but was never linked. */
export function signOutUnlinkedDevice(params: { token: string; deviceId: string }) {
  return api.signOutDevice(params.deviceId, params.token);
}
