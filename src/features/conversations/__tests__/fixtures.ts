import type { Conversation } from "../conversationsStore";
import type { ChatMessage } from "../../../stores/messagesStore";

export const ME = { id: "me", username: "me" };

let counter = 0;

export function member(id: string, username = id) {
  return { id: `m-${id}-${++counter}`, userId: id, role: "member", minReadableKeyVersion: 1, user: { id, username } };
}

export function conversation(overrides: Partial<Conversation> & { id: string }): Conversation {
  return {
    type: "dm",
    name: null,
    createdBy: ME.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    encryptedTitle: null,
    titleNonce: null,
    encryptedImageUrl: null,
    imageUrlNonce: null,
    passcodeEnabled: false,
    passcodeLength: 4,
    passcodeDisableRequestedBy: null,
    lockMode: "on_leave",
    lockTimeoutSeconds: null,
    members: [member(ME.id, ME.username)],
    ...overrides
  };
}

export function dm(id: string, partner: string, extra: Partial<Conversation> = {}) {
  return conversation({ id, type: "dm", members: [member(ME.id, ME.username), member(partner)], ...extra });
}

export function group(id: string, others: string[], extra: Partial<Conversation> = {}) {
  return conversation({ id, type: "group", members: [member(ME.id, ME.username), ...others.map((o) => member(o))], ...extra });
}

export function message(id: string, createdAt: number, senderId = "someone", extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, senderId, sender: senderId, cipherText: "x", createdAt, ...extra };
}
