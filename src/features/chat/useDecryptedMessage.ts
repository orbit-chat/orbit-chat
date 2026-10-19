import { useEffect } from "react";
import { useE2EEStore } from "../../stores/e2eeStore";
import type { ChatMessage } from "../../stores/messagesStore";
import { useDecryptedStore, type DecryptedEntry } from "./decryptedStore";

export type DecryptState = DecryptedEntry | { status: "pending" } | { status: "nokey" };

/**
 * Decrypted content of a message, decrypting it once if needed. Re-runs when the
 * conversation key for the message's version becomes available.
 */
export function useDecryptedMessage(conversationId: string, message: ChatMessage, enabled = true): DecryptState {
  const secretKey = useE2EEStore((s) => s.getConversationSecretKeyForVersion(conversationId, message.keyVersion));
  const entry = useDecryptedStore((s) => s.byMessageId[message.id]);

  useEffect(() => {
    if (!enabled || !secretKey || entry?.status === "ok") return;
    void useDecryptedStore.getState().ensure(message, secretKey);
  }, [enabled, secretKey, entry?.status, message]);

  if (entry?.status === "ok") return entry;
  if (!secretKey) return { status: "nokey" };
  return entry ?? { status: "pending" };
}
