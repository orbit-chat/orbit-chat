import { create } from "zustand";
import * as api from "../lib/api";
import {
  generateKeypair,
  generateSecretKey,
  openSealedWithKeypair,
  publicKeyFromPrivateKey,
  sealToPublicKey,
} from "../lib/crypto";

function latestKey(keys: { publicKey: string; createdAt: string }[]) {
  if (!keys.length) return null;
  // keys are already ordered desc on the server, but keep this robust
  return keys
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]!
    .publicKey;
}

function getPrivateKeyStorageKey(userId: string) {
  return `orbit:privateKey:${userId}`;
}

type E2EEState = {
  secretKeyByConversationId: Record<string, string>;
  loadingByConversationId: Record<string, boolean>;
  errorByConversationId: Record<string, string | null>;

  ensureDeviceKeypair: (userId: string, token: string) => Promise<{ publicKey: string; privateKey: string }>;

  getConversationSecretKey: (conversationId: string) => string | null;
  ensureConversationSecretKey: (params: {
    conversation: api.Conversation;
    token: string;
    myUserId: string;
  }) => Promise<string | null>;
};

export const useE2EEStore = create<E2EEState>((set, get) => ({
  secretKeyByConversationId: {},
  loadingByConversationId: {},
  errorByConversationId: {},

  ensureDeviceKeypair: async (userId, token) => {
    const existingPrivateKey = localStorage.getItem(getPrivateKeyStorageKey(userId));
    if (existingPrivateKey) {
      const publicKey = await publicKeyFromPrivateKey(existingPrivateKey);
      return { publicKey, privateKey: existingPrivateKey };
    }

    // Create a new device keypair and register the public key.
    const keypair = await generateKeypair();
    await api.addMyPublicKey(keypair.publicKey, token);
    localStorage.setItem(getPrivateKeyStorageKey(userId), keypair.privateKey);
    return keypair;
  },

  getConversationSecretKey: (conversationId) => get().secretKeyByConversationId[conversationId] ?? null,

  ensureConversationSecretKey: async ({ conversation, token, myUserId }) => {
    const cached = get().secretKeyByConversationId[conversation.id];
    if (cached) return cached;

    set({
      loadingByConversationId: { ...get().loadingByConversationId, [conversation.id]: true },
      errorByConversationId: { ...get().errorByConversationId, [conversation.id]: null },
    });

    try {
      const { publicKey: myPublicKey, privateKey: myPrivateKey } = await get().ensureDeviceKeypair(myUserId, token);

      // 1) Try to fetch my encrypted conversation keys and decrypt the latest.
      const existingKeys = await api.getMyConversationKeys(conversation.id, token).catch(() => [] as api.ConversationKey[]);
      const latest = existingKeys
        .slice()
        .sort((a, b) => (b.keyVersion ?? 0) - (a.keyVersion ?? 0))[0];

      if (latest?.encryptedGroupKey) {
        const secretKey = await openSealedWithKeypair(latest.encryptedGroupKey, myPublicKey, myPrivateKey);
        set({
          secretKeyByConversationId: { ...get().secretKeyByConversationId, [conversation.id]: secretKey },
          loadingByConversationId: { ...get().loadingByConversationId, [conversation.id]: false },
        });
        return secretKey;
      }

      // 2) No stored key yet: bootstrap one for DMs by encrypting a new secret key to each member.
      if (conversation.type !== "dm") {
        throw new Error("Missing conversation key");
      }

      const other = conversation.members.find((m) => m.user.id !== myUserId)?.user;
      if (!other?.id) throw new Error("Missing DM partner");

      const otherKeys = await api.getUserKeys(other.id, token);
      const otherPublicKey = latestKey(otherKeys);
      if (!otherPublicKey) throw new Error("DM partner has no public key");

      const secretKey = await generateSecretKey();
      const encryptedForMe = await sealToPublicKey(secretKey, myPublicKey);
      const encryptedForOther = await sealToPublicKey(secretKey, otherPublicKey);

      await Promise.all([
        api.storeConversationKey(
          { conversationId: conversation.id, userId: myUserId, encryptedGroupKey: encryptedForMe, keyVersion: 1 },
          token
        ),
        api.storeConversationKey(
          { conversationId: conversation.id, userId: other.id, encryptedGroupKey: encryptedForOther, keyVersion: 1 },
          token
        ),
      ]);

      set({
        secretKeyByConversationId: { ...get().secretKeyByConversationId, [conversation.id]: secretKey },
        loadingByConversationId: { ...get().loadingByConversationId, [conversation.id]: false },
      });
      return secretKey;
    } catch (err: any) {
      set({
        loadingByConversationId: { ...get().loadingByConversationId, [conversation.id]: false },
        errorByConversationId: { ...get().errorByConversationId, [conversation.id]: err?.message ?? "E2EE failed" },
      });
      return null;
    }
  },
}));
