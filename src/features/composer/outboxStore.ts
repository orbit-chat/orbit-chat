import { create } from "zustand";
import { encryptMessage } from "../../lib/crypto";
import { useAuthStore } from "../../stores/authStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import { useSocketStore } from "../../stores/socketStore";
import { useConversationsStore } from "../conversations/conversationsStore";
import { useDecryptedStore } from "../chat/decryptedStore";
import type { GifLinkAttachment, MessageAttachment, MessageEnvelope } from "../chat/envelope";
import { encryptAndUpload } from "./encryptAttachment";

/** How long to wait for the server to echo a sent message before calling it failed. */
export const CONFIRM_TIMEOUT_MS = 20_000;

type WirePayload = {
  conversationId: string;
  ciphertext: string;
  nonce: string;
  parentMessageId?: string;
  keyVersion: number;
  mediaIds: string[];
  type: "text" | "media";
};

export type OutboxEntry = {
  localId: string;
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
};

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
  retry: (localId: string) => Promise<void>;
  discard: (localId: string) => void;
  reset: () => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let nextId = 0;

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
    const socket = useSocketStore.getState().socket;
    if (!socket) {
      fail(entry.localId, "You're offline. Retry when the connection is back.");
      return;
    }
    // socket.io buffers this while reconnecting; the timeout catches it if it never lands.
    socket.emit("send_message", payload);
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
      const e2ee = useE2EEStore.getState();
      const key = await e2ee.ensureConversationSecretKey({ conversation, token: auth.token, myUserId: auth.user.id });
      if (!key) throw new Error("This device doesn't have the key for this conversation yet.");

      const uploaded: MessageAttachment[] = [];
      for (const file of entry.files) {
        uploaded.push(await encryptAndUpload({ file, conversationId: conversation.id, conversationKey: key, token: auth.token }));
      }
      const envelope: MessageEnvelope = { text: entry.envelope.text, attachments: [...uploaded, ...entry.envelope.attachments] };
      const { cipherText, nonce } = await encryptMessage(JSON.stringify(envelope), key);
      const mediaIds = uploaded.flatMap((a) => (a.kind === "gif_link" ? [] : [a.mediaId]));
      patch(localId, { envelope, files: [] });
      emit(get().entries.find((e) => e.localId === localId)!, {
        conversationId: conversation.id,
        ciphertext: cipherText,
        nonce,
        ...(entry.parentMessageId ? { parentMessageId: entry.parentMessageId } : {}),
        keyVersion: useE2EEStore.getState().getConversationKeyVersion(conversation.id) ?? 1,
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
        conversationId: input.conversationId,
        createdAt: Date.now(),
        parentMessageId: input.parentMessageId,
        envelope: { text: input.text, attachments: input.gif ? [input.gif] : [] },
        files: input.files,
        status: "preparing",
        error: null,
        payload: null
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
