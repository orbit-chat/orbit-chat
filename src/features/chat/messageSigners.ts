import { useEffect } from "react";
import { create } from "zustand";
import { getContactDevices, getFormerDevice, getOwnDevices } from "../../lib/deviceIdentity";
import { verifyMessageSignature, type DeviceListEntry } from "../../lib/deviceTrust";
import { useAuthStore } from "../../stores/authStore";
import type { ChatMessage } from "../../stores/messagesStore";

/**
 * Who really sent a message (mobile plan B9). The server says who the sender is; the signature,
 * checked against the sender's signed device list, is what proves it. Without it any member's
 * device could write a message the app attributes to someone else.
 *
 * - `verified`: signed by a device on the sender's current verified list.
 * - `former-device`: signed by a device that has since been removed from the sender's list.
 * - `invalid`: the signature doesn't verify, or the device isn't one of the sender's (or their
 *   list can't be verified, e.g. after an unreviewed identity change).
 * - `legacy`: sent before messages were signed. Not an error, just unproven.
 * - `unknown`: this device can't check right now (it isn't linked yet, so it can't verify its own
 *   user's list, or the lookup failed). Not a warning; checked again later.
 */
export type SignerStatus = "verified" | "former-device" | "invalid" | "legacy" | "unknown";

/** A user's devices as far as this device can tell: verified, a changed identity, or not checkable now. */
type DeviceLookup = { devices: DeviceListEntry[] } | { identityChanged: true } | { unavailable: true };

type SignerState = {
  byMessageId: Record<string, SignerStatus>;
  set: (messageId: string, status: SignerStatus) => void;
  reset: () => void;
};

export const useSignerStore = create<SignerState>((set, get) => ({
  byMessageId: {},
  set: (messageId, status) => set({ byMessageId: { ...get().byMessageId, [messageId]: status } }),
  reset: () => set({ byMessageId: {} }),
}));

const LIST_CACHE_MS = 60_000;
const listCache = new Map<string, { at: number; devices: Promise<DeviceLookup> }>();
const formerCache = new Map<string, Promise<DeviceListEntry | null>>();
const inFlight = new Map<string, Promise<SignerStatus>>();

/** A user's current verified devices (cached briefly: every message would otherwise refetch). */
function currentDevices(myUserId: string, userId: string, token: string) {
  const key = `${myUserId}:${userId}`;
  const cached = listCache.get(key);
  if (cached && Date.now() - cached.at < LIST_CACHE_MS) return cached.devices;
  const devices = (async (): Promise<DeviceLookup> => {
    try {
      // Throws on a device that isn't linked: it doesn't hold the identity to check its own list.
      if (userId === myUserId) return { devices: (await getOwnDevices(myUserId, token)).devices };
      const contact = await getContactDevices(myUserId, userId, token);
      if (contact.status === "verified") return { devices: contact.devices };
      if (contact.status === "identity-changed") return { identityChanged: true };
      return { unavailable: true };
    } catch {
      return { unavailable: true };
    }
  })();
  listCache.set(key, { at: Date.now(), devices });
  return devices;
}

function formerDevice(myUserId: string, userId: string, deviceId: string, token: string) {
  const key = `${myUserId}:${userId}:${deviceId}`;
  let pending = formerCache.get(key);
  if (!pending) {
    pending = getFormerDevice(myUserId, userId, deviceId, token).catch(() => null);
    formerCache.set(key, pending);
  }
  return pending;
}

/** Check one message's signature. Exported for tests; the app uses `useMessageSigner`. */
export async function checkMessageSigner(
  conversationId: string,
  message: Pick<ChatMessage, "id" | "senderId" | "senderDeviceId" | "signature" | "keyVersion" | "nonce" | "cipherText">,
  me: { userId: string; token: string }
): Promise<SignerStatus> {
  if (!message.signature || !message.senderDeviceId) return "legacy";
  if (!message.nonce) return "invalid";
  const fields = {
    conversationId,
    keyVersion: message.keyVersion ?? 1,
    messageId: message.id,
    nonce: message.nonce,
    cipherText: message.cipherText,
  };
  const verify = async (device: DeviceListEntry | null | undefined) => {
    if (!device) return false;
    try {
      return await verifyMessageSignature(fields, message.signature!, device.signingPublicKey);
    } catch {
      return false;
    }
  };

  const lookup = await currentDevices(me.userId, message.senderId, me.token);
  if ("unavailable" in lookup) return "unknown";
  // An unreviewed identity change: nothing from them can be vouched for until the user reviews it.
  if ("identityChanged" in lookup) return "invalid";
  const current = lookup.devices.find((d) => d.deviceId === message.senderDeviceId);
  if (current) return (await verify(current)) ? "verified" : "invalid";
  const former = await formerDevice(me.userId, message.senderId, message.senderDeviceId, me.token);
  return (await verify(former)) ? "former-device" : "invalid";
}

/** The signer status for a message, checked once per message and cached for the session. */
export function useMessageSigner(conversationId: string, message: ChatMessage, enabled = true): SignerStatus | null {
  const status = useSignerStore((s) => s.byMessageId[message.id] ?? null);
  useEffect(() => {
    if (!enabled || status) return;
    const { token, user } = useAuthStore.getState();
    if (!token || !user) return;
    let pending = inFlight.get(message.id);
    if (!pending) {
      pending = checkMessageSigner(conversationId, message, { userId: user.id, token }).finally(() => inFlight.delete(message.id));
      inFlight.set(message.id, pending);
    }
    let live = true;
    void pending.then((result) => {
      // "Can't check now" isn't remembered, so the message is checked again when it next renders.
      if (live && result !== "unknown") useSignerStore.getState().set(message.id, result);
    });
    return () => {
      live = false;
    };
  }, [enabled, status, conversationId, message]);
  return status;
}

/** Forget cached lists and results (sign-out). */
export function resetMessageSigners() {
  listCache.clear();
  formerCache.clear();
  inFlight.clear();
  useSignerStore.getState().reset();
}
