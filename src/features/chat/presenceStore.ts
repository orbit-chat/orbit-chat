import { create } from "zustand";

/** Drop a typing indicator if no stop event arrives (the other client may have crashed or gone offline). */
export const TYPING_EXPIRY_MS = 6000;

type PresenceState = {
  /** Who is typing right now, per conversation. */
  typingByConversation: Record<string, string[]>;
  /** Who has seen each message. Live only: the server doesn't return receipts with history. */
  seenByMessage: Record<string, string[]>;
  startTyping: (conversationId: string, userId: string) => void;
  stopTyping: (conversationId: string, userId: string) => void;
  markSeenBy: (messageId: string, userId: string) => void;
  reset: () => void;
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const usePresenceStore = create<PresenceState>((set, get) => ({
  typingByConversation: {},
  seenByMessage: {},

  startTyping: (conversationId, userId) => {
    const key = `${conversationId}:${userId}`;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(key, setTimeout(() => get().stopTyping(conversationId, userId), TYPING_EXPIRY_MS));
    const current = get().typingByConversation[conversationId] ?? [];
    if (!current.includes(userId)) set({ typingByConversation: { ...get().typingByConversation, [conversationId]: [...current, userId] } });
  },

  stopTyping: (conversationId, userId) => {
    const key = `${conversationId}:${userId}`;
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
    const current = get().typingByConversation[conversationId] ?? [];
    if (!current.includes(userId)) return;
    const next = current.filter((id) => id !== userId);
    const { [conversationId]: _removed, ...rest } = get().typingByConversation;
    set({ typingByConversation: next.length ? { ...rest, [conversationId]: next } : rest });
  },

  markSeenBy: (messageId, userId) => {
    const current = get().seenByMessage[messageId] ?? [];
    if (current.includes(userId)) return;
    set({ seenByMessage: { ...get().seenByMessage, [messageId]: [...current, userId] } });
  },

  reset: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ typingByConversation: {}, seenByMessage: {} });
  }
}));
