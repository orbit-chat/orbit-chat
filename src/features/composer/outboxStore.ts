import { create } from "zustand";
import { KEY_ERROR } from "../../lib/api";
import { decryptMessage, encryptMessage } from "../../lib/crypto";
import { signMessage } from "../../lib/deviceTrust";
import { useAuthStore } from "../../stores/authStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { emitAction } from "../chat/socketActions";
import { useConversationsStore } from "../conversations/conversationsStore";
import { ensureSendableKey } from "../conversations/conversationKeyOps";
import { useDecryptedStore } from "../chat/decryptedStore";
import type { GifLinkAttachment, MessageAttachment, MessageEnvelope } from "../chat/envelope";
import { encryptAndUpload } from "./encryptAttachment";

/** How long to wait for the server to echo a sent message before calling it failed. */
export const CONFIRM_TIMEOUT_MS = 20_000;

type WirePayload = {
  conversationId: string;
  /** Chosen here because the signature covers it; a resend with the same ID can't duplicate (B9). */
  messageId: string;
  signature?: string;
  ciphertext: string;
  nonce: string;
  parentMessageId?: string;
  keyVersion: number;
  mediaIds: string[];
  type: "text" | "media";
};

export type OutboxEntry = {
  localId: string;
  /** The server ID this message will have. Kept across retries and re-encrypts. */
  messageId: string;
  conversationId: string;
  createdAt: number;
  parentMessageId: string | null;
  /** What the user wrote; shown in the pending bubble. Memory only. */
  envelope: MessageEnvelope;
  /** Kept until the files are uploaded, so a failed upload can be retried. */
  files: File[];
  status: "preparing" | "sending" | "failed";
  error: string | null;
  /** Set once encrypted; a retry re-sends exactly this. */
  payload: WirePayload | null;
  /** The key version uploaded attachments' file keys are wrapped with, so a re-encrypt can re-wrap them. */
  wrappedWithKeyVersion: number | null;
  /** Automatic re-encrypts after the server said the key changed; capped so a misbehaving server can't loop us. */
  keyRetries: number;
};

/** What the server's socket `error` event carries for a refused send. */
export type SendError = { message?: string; code?: string; conversationId?: string };

export type SendInput = {
  conversationId: string;
  text: string;
  files: File[];
  gif: GifLinkAttachment | null;
  parentMessageId: string | null;
};

type OutboxState = {
  entries: OutboxEntry[];
  send: (input: SendInput) => Promise<void>;
  /** The server echoed a message: if it's one of ours, hand its plaintext to the cache and drop the pending copy. */
  confirm: (message: { id: string; conversationId: string; ciphertext: string }) => void;
  /** The server reported an error; it doesn't say for which message, so blame the oldest one in flight. */
  failOldestSending: (reason: string) => void;
  /**
   * The server refused a send. Key changes (someone rotated, or a member left and the chat must
   * rotate) re-encrypt and resend once on their own; anything else fails the message.
   */
  handleSendError: (error: SendError) => void;
  retry: (localId: string) => Promise<void>;
  discard: (localId: string) => void;
  reset: () => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let nextId = 0;

const MAX_KEY_RETRIES = 1;

/** Re-wrap uploaded files' keys from one conversation key to another; the uploaded bytes don't change. */
async function rewrapAttachments(attachments: MessageAttachment[], fromKey: string, toKey: string): Promise<MessageAttachment[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.kind === "gif_link") return attachment;
      const fileKey = await decryptMessage(attachment.fileKeyCiphertext, attachment.fileKeyNonce, fromKey);
      const wrapped = await encryptMessage(fileKey, toKey);
      return { ...attachment, fileKeyCiphertext: wrapped.cipherText, fileKeyNonce: wrapped.nonce };
    })
  );
}

/** User-facing text for a refused send that won't be retried automatically. */
function sendErrorMessage(error: SendError) {
  switch (error.code) {
    case KEY_ERROR.deviceNotLinked:
      return "This device isn't linked to your account yet, so it can't send. Link it from one of your other devices.";
    case KEY_ERROR.updateRequired:
      return "Update Orbit to keep sending messages.";
    case KEY_ERROR.rotationRequired:
    case KEY_ERROR.staleKeyVersion:
      return "This chat's key changed while sending. Retry to send it with the new key.";
    default:
      return error.message ?? "The server rejected this message.";
  }
}

function clearTimer(localId: string) {
  const timer = timers.get(localId);
  if (timer) clearTimeout(timer);
  timers.delete(localId);
}

export const useOutboxStore = create<OutboxState>((set, get) => {
  const patch = (localId: string, value: Partial<OutboxEntry>) =>
    set({ entries: get().entries.map((e) => (e.localId === localId ? { ...e, ...value } : e)) });
  const fail = (localId: string, error: string) => {
    clearTimer(localId);
    patch(localId, { status: "failed", error });
  };

  const emit = (entry: OutboxEntry, payload: WirePayload) => {
    // socket.io buffers this while reconnecting; the timeout catches it if it never lands.
    if (!emitAction("send_message", payload)) {
      fail(entry.localId, "You're offline. Retry when the connection is back.");
      return;
    }
    patch(entry.localId, { status: "sending", error: null, payload });
    clearTimer(entry.localId);
    timers.set(
      entry.localId,
      setTimeout(() => fail(entry.localId, "The server didn't confirm this message."), CONFIRM_TIMEOUT_MS)
    );
  };

  /** Encrypt (uploading files first) and send. */
  const prepareAndSend = async (localId: string) => {
    const entry = get().entries.find((e) => e.localId === localId);
    const auth = useAuthStore.getState();
    const conversation = useConversationsStore.getState().conversations.find((c) => c.id === entry?.conversationId);
    if (!entry) return;
    if (!auth.token || !auth.user) return fail(localId, "You're signed out. Sign in again to send.");
    if (!conversation) return fail(localId, "This conversation isn't available anymore.");
    patch(localId, { status: "preparing", error: null });

    try {
      // With per-device keys this rotates first if the newest key isn't safe to send with.
      const sendable = await ensureSendableKey({ conversation, token: auth.token, myUserId: auth.user.id });
      if (!sendable) throw new Error("This device doesn't have the key for this conversation yet.");
      const { secretKey: key, keyVersion } = sendable;

      // Files already uploaded under an older key keep their bytes; only their wrapped file keys change.
      let attachments = entry.envelope.attachments;
      if (entry.wrappedWithKeyVersion !== null && entry.wrappedWithKeyVersion !== keyVersion) {
        const previousKey = useE2EEStore.getState().getConversationSecretKeyForVersion(conversation.id, entry.wrappedWithKeyVersion);
        if (!previousKey) throw new Error("This message's files can't be re-sent with the chat's new key. Send them again.");
        attachments = await rewrapAttachments(attachments, previousKey, key);
      }

      const uploaded: MessageAttachment[] = [];
      for (const file of entry.files) {
        uploaded.push(await encryptAndUpload({ file, conversationId: conversation.id, conversationKey: key, token: auth.token }));
      }
      const envelope: MessageEnvelope = { text: entry.envelope.text, attachments: [...uploaded, ...attachments] };
      const { cipherText, nonce } = await encryptMessage(JSON.stringify(envelope), key);
      const mediaIds = envelope.attachments.flatMap((a) => (a.kind === "gif_link" ? [] : [a.mediaId]));
      // Per-device keys: every message is signed by this device (B9), so nobody else's device can
      // write a message that shows up as ours.
      let signature: string | undefined;
      if (await useE2EEStore.getState().ensureKeyMode(auth.user.id)) {
        const me = await useE2EEStore.getState().thisDevice(auth.user.id, auth.token);
        signature = await signMessage(
          { conversationId: conversation.id, keyVersion, messageId: entry.messageId, nonce, cipherText },
          me.signingPrivateKey
        );
      }
      patch(localId, { envelope, files: [], wrappedWithKeyVersion: keyVersion });
      emit(get().entries.find((e) => e.localId === localId)!, {
        conversationId: conversation.id,
        messageId: entry.messageId,
        ...(signature ? { signature } : {}),
        ciphertext: cipherText,
        nonce,
        ...(entry.parentMessageId ? { parentMessageId: entry.parentMessageId } : {}),
        keyVersion,
        mediaIds,
        type: envelope.attachments.length ? "media" : "text"
      });
    } catch (err) {
      fail(localId, err instanceof Error ? err.message : "Couldn't send this message.");
    }
  };

  return {
    entries: [],

    send: async (input) => {
      const localId = `local-${Date.now()}-${++nextId}`;
      const entry: OutboxEntry = {
        localId,
        messageId: crypto.randomUUID(),
        conversationId: input.conversationId,
        createdAt: Date.now(),
        parentMessageId: input.parentMessageId,
        envelope: { text: input.text, attachments: input.gif ? [input.gif] : [] },
        files: input.files,
        status: "preparing",
        error: null,
        payload: null,
        wrappedWithKeyVersion: null,
        keyRetries: 0
      };
      set({ entries: [...get().entries, entry] });
      await prepareAndSend(localId);
    },

    confirm: (message) => {
      const entry = get().entries.find((e) => e.payload?.ciphertext === message.ciphertext && e.conversationId === message.conversationId);
      if (!entry) return;
      clearTimer(entry.localId);
      // Our own message: no need to decrypt what we just wrote.
      useDecryptedStore.setState((s) => ({ byMessageId: { ...s.byMessageId, [message.id]: { status: "ok", envelope: entry.envelope } } }));
      set({ entries: get().entries.filter((e) => e.localId !== entry.localId) });
    },

    failOldestSending: (reason) => {
      const oldest = get().entries.find((e) => e.status === "sending");
      if (oldest) fail(oldest.localId, reason);
    },

    handleSendError: (error) => {
      const oldest = get().entries.find(
        (e) => e.status === "sending" && (!error.conversationId || e.conversationId === error.conversationId)
      );
      if (!oldest) return;
      const keyChanged = error.code === KEY_ERROR.rotationRequired || error.code === KEY_ERROR.staleKeyVersion;
      if (!keyChanged || oldest.keyRetries >= MAX_KEY_RETRIES) {
        // After a key change the old ciphertext can never be accepted: a manual retry re-encrypts.
        if (keyChanged) patch(oldest.localId, { payload: null });
        fail(oldest.localId, sendErrorMessage(error));
        return;
      }

      clearTimer(oldest.localId);
      // The old ciphertext is useless now: forget it so the resend encrypts with the new key.
      patch(oldest.localId, { status: "preparing", error: null, payload: null, keyRetries: oldest.keyRetries + 1 });
      const auth = useAuthStore.getState();
      const conversation = useConversationsStore.getState().conversations.find((c) => c.id === oldest.conversationId);
      void (async () => {
        if (conversation && auth.token && auth.user) {
          if (error.code === KEY_ERROR.rotationRequired) {
            // A member left; the next send (this one) rotates first.
            useConversationsStore.getState().upsert({ ...conversation, rotationRequired: true });
          } else {
            await useE2EEStore.getState().ensureConversationSecretKey({ conversation, token: auth.token, myUserId: auth.user.id, forceRefresh: true });
          }
        }
        await prepareAndSend(oldest.localId);
      })();
    },

    retry: async (localId) => {
      const entry = get().entries.find((e) => e.localId === localId);
      if (!entry || entry.status !== "failed") return;
      if (entry.payload) emit(entry, entry.payload);
      else await prepareAndSend(localId);
    },

    discard: (localId) => {
      clearTimer(localId);
      set({ entries: get().entries.filter((e) => e.localId !== localId) });
    },

    reset: () => {
      for (const id of timers.keys()) clearTimer(id);
      set({ entries: [] });
    }
  };
});
