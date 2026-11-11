import { useEffect } from "react";
import { create } from "zustand";
import {
  acceptContactIdentity,
  getContactDevices,
  isContactVerified,
  markContactVerified,
  onContactDevicesAdded,
} from "../../lib/deviceIdentity";
import { useAuthStore } from "../../stores/authStore";
import type { Conversation } from "../conversations/conversationsStore";

/**
 * What this device knows about each contact's identity (mobile plan B6): whether their signed
 * device list verifies against the pinned identity, whether the user compared safety numbers,
 * and devices they added since last seen. Drives the notices in chats and the safety-number screen.
 */
export type ContactTrust =
  | { status: "ok"; identityKey: string; verified: boolean }
  | { status: "identity-changed"; pinnedIdentityKey: string; currentIdentityKey: string }
  | { status: "no-identity" }
  | { status: "error" };

type TrustState = {
  byUserId: Record<string, ContactTrust>;
  /** Names of devices each contact added since this device last looked, until dismissed. */
  newDevicesByUserId: Record<string, string[]>;
  set: (userId: string, trust: ContactTrust) => void;
  addNewDevices: (userId: string, names: string[]) => void;
  dismissNewDevices: (userId: string) => void;
  reset: () => void;
};

const refreshedAt = new Map<string, number>();

export const useContactTrustStore = create<TrustState>((set, get) => ({
  byUserId: {},
  newDevicesByUserId: {},
  set: (userId, trust) => set({ byUserId: { ...get().byUserId, [userId]: trust } }),
  addNewDevices: (userId, names) =>
    set({ newDevicesByUserId: { ...get().newDevicesByUserId, [userId]: [...new Set([...(get().newDevicesByUserId[userId] ?? []), ...names])] } }),
  dismissNewDevices: (userId) => {
    const next = { ...get().newDevicesByUserId };
    delete next[userId];
    set({ newDevicesByUserId: next });
  },
  reset: () => {
    refreshedAt.clear();
    set({ byUserId: {}, newDevicesByUserId: {} });
  },
}));

// Any lookup (sealing, opening keys, checking signatures) can be the one that sees a new device.
onContactDevicesAdded((userId, added) => useContactTrustStore.getState().addNewDevices(userId, added.map((d) => d.name)));

const REFRESH_MS = 60_000;

/**
 * Look a contact up again (at most once a minute unless forced). `me` defaults to the signed-in
 * session; callers that already have it (the send path) pass it, so the check can't silently skip.
 */
export async function refreshContactTrust(userId: string, options: { force?: boolean; me?: { userId: string; token: string } } = {}) {
  const session = useAuthStore.getState();
  const me = options.me ?? (session.token && session.user ? { userId: session.user.id, token: session.token } : null);
  if (!me) throw new Error("You're signed out.");
  if (userId === me.userId) return;
  const user = { id: me.userId };
  const token = me.token;
  if (!options.force && Date.now() - (refreshedAt.get(userId) ?? 0) < REFRESH_MS) return;
  refreshedAt.set(userId, Date.now());
  const store = useContactTrustStore.getState();
  try {
    const devices = await getContactDevices(user.id, userId, token);
    if (devices.status === "verified") {
      store.set(userId, { status: "ok", identityKey: devices.identityKey, verified: await isContactVerified(user.id, userId) });
    } else if (devices.status === "identity-changed") {
      store.set(userId, devices);
    } else {
      store.set(userId, { status: "no-identity" });
    }
  } catch {
    store.set(userId, { status: "error" });
  }
}

/** The user reviewed a changed identity and accepts the new key. Sealing to them resumes. */
export async function acceptNewIdentity(userId: string, identityKey: string) {
  const user = useAuthStore.getState().user;
  if (!user) return;
  await acceptContactIdentity(user.id, userId, identityKey);
  await refreshContactTrust(userId, { force: true });
}

/** The user compared safety numbers in person (or by QR). */
export async function setContactVerified(userId: string, identityKey: string, verified: boolean) {
  const user = useAuthStore.getState().user;
  if (!user) return;
  await markContactVerified(user.id, userId, identityKey, verified);
  await refreshContactTrust(userId, { force: true });
}

/** Keep the trust state of a conversation's other members fresh while it's open. */
export function useConversationTrust(conversation: Conversation, myUserId: string) {
  const others = conversation.members.map((m) => m.userId).filter((id) => id !== myUserId);
  const key = others.join(",");
  useEffect(() => {
    for (const userId of others) void refreshContactTrust(userId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const byUserId = useContactTrustStore((s) => s.byUserId);
  const newDevices = useContactTrustStore((s) => s.newDevicesByUserId);
  return {
    changed: others.filter((id) => byUserId[id]?.status === "identity-changed"),
    newDevices: others.filter((id) => newDevices[id]?.length).map((id) => ({ userId: id, names: newDevices[id]! })),
  };
}
