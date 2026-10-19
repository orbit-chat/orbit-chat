import { create } from "zustand";
import { decryptEnvelope, type MessageEnvelope } from "./envelope";

export type DecryptedEntry =
  | { status: "ok"; envelope: MessageEnvelope }
  /** Decryption ran and failed: wrong key, tampered or truncated ciphertext. */
  | { status: "failed" };

type DecryptedState = {
  /** Plaintext lives only in memory. It is never persisted and is cleared on sign-out. */
  byMessageId: Record<string, DecryptedEntry>;
  /** Decrypt once per message; concurrent callers share the work. */
  ensure: (message: { id: string; cipherText: string; nonce?: string }, secretKey: string) => Promise<DecryptedEntry>;
  reset: () => void;
};

const inFlight = new Map<string, Promise<DecryptedEntry>>();
let generation = 0;

export const useDecryptedStore = create<DecryptedState>((set, get) => ({
  byMessageId: {},

  ensure: (message, secretKey) => {
    const cached = get().byMessageId[message.id];
    if (cached?.status === "ok") return Promise.resolve(cached);

    // A failed entry is retried with a different key (e.g. after a key refresh).
    const flightKey = `${message.id}:${secretKey}`;
    const pending = inFlight.get(flightKey);
    if (pending) return pending;

    const startedIn = generation;
    const work = (async (): Promise<DecryptedEntry> => {
      let entry: DecryptedEntry;
      try {
        if (!message.nonce) throw new Error("Message has no nonce");
        entry = { status: "ok", envelope: await decryptEnvelope(message.cipherText, message.nonce, secretKey) };
      } catch {
        entry = { status: "failed" };
      }
      // Don't repopulate the cache after a sign-out reset.
      if (startedIn === generation) set({ byMessageId: { ...get().byMessageId, [message.id]: entry } });
      return entry;
    })().finally(() => inFlight.delete(flightKey));

    inFlight.set(flightKey, work);
    return work;
  },

  reset: () => {
    generation++;
    inFlight.clear();
    set({ byMessageId: {} });
  }
}));
