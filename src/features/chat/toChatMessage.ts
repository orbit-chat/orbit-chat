import type { ServerMessage } from "../../lib/api";
import type { ChatMessage } from "../../stores/messagesStore";

/** REST message shape → the shape kept in messagesStore (ciphertext stays encrypted). */
export function toChatMessage(message: ServerMessage): ChatMessage {
  return {
    id: message.id,
    senderId: message.sender.id,
    sender: message.sender.username,
    parentMessageId: message.parentMessageId,
    cipherText: message.ciphertext,
    keyVersion: message.keyVersion,
    nonce: message.nonce,
    mediaIds: message.mediaIds ?? [],
    reactions: message.reactions ?? [],
    isPinned: message.isPinned ?? false,
    createdAt: new Date(message.createdAt).getTime(),
    senderDeviceId: message.senderDeviceId ?? null,
    signature: message.signature ?? null
  };
}
