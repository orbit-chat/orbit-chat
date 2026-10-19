import { useSocketStore } from "../../stores/socketStore";

/**
 * The server reports every failure on one generic `error` event without saying which
 * request failed. Routing emits through here records the most recent one, so a listener
 * can tell whether an error plausibly belongs to it (e.g. the outbox only blames a
 * pending send when a send was the last thing emitted).
 */
let lastEmit: { event: string; at: number } | null = null;

/** Window in which an `error` is attributed to the last emit. */
export const ERROR_ATTRIBUTION_MS = 10_000;

export function emitAction(event: string, payload: unknown): boolean {
  const socket = useSocketStore.getState().socket;
  if (!socket) return false;
  socket.emit(event, payload);
  lastEmit = { event, at: Date.now() };
  return true;
}

/** True if an error arriving now most likely answers an `event` emit. */
export function errorLikelyFrom(event: string, now = Date.now()) {
  return lastEmit?.event === event && now - lastEmit.at < ERROR_ATTRIBUTION_MS;
}

export function resetLastEmit() {
  lastEmit = null;
}

export const toggleReaction = (conversationId: string, messageId: string, emoji: string) =>
  emitAction("toggle_reaction", { conversationId, messageId, emoji });

export const togglePin = (conversationId: string, messageId: string) => emitAction("toggle_message_pin", { conversationId, messageId });

export const markSeen = (conversationId: string, messageId: string) => emitAction("message_seen", { conversationId, messageId });

export const joinConversation = (conversationId: string) => emitAction("join_conversation", { conversationId });
