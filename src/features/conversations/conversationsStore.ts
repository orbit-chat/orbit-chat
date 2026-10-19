import { create } from "zustand";
import * as api from "../../lib/api";

export type Conversation = api.Conversation;

/** A one-time passcode to reveal when the user next opens that chat (sent by the server on create/re-enable). */
export type PendingPasscode = { passcode: string; label: string };

type ConversationsState = {
  conversations: Conversation[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  pendingPasscodes: Record<string, PendingPasscode>;

  /** Fetch the full list. Keeps the current list on failure so a blip doesn't empty the sidebar. */
  load: (token: string) => Promise<void>;
  /** Insert or replace by id. New conversations go first. */
  upsert: (conversation: Conversation) => void;
  remove: (conversationId: string) => void;
  removeMember: (conversationId: string, userId: string) => void;
  setPendingPasscode: (conversationId: string, value: PendingPasscode) => void;
  /** Returns and clears the pending passcode for a conversation, if any. */
  takePendingPasscode: (conversationId: string) => PendingPasscode | null;
  reset: () => void;
};

const initial = {
  conversations: [] as Conversation[],
  status: "idle" as const,
  error: null,
  pendingPasscodes: {} as Record<string, PendingPasscode>
};

let loadSequence = 0;

export const useConversationsStore = create<ConversationsState>((set, get) => ({
  ...initial,

  load: async (token) => {
    const sequence = ++loadSequence;
    set({ status: get().status === "ready" ? "ready" : "loading", error: null });
    try {
      const conversations = await api.getConversations(token);
      // A newer load (or a sign-out reset) superseded this one.
      if (sequence !== loadSequence) return;
      set({ conversations, status: "ready" });
    } catch (err) {
      if (sequence !== loadSequence) return;
      set({ status: get().conversations.length ? "ready" : "error", error: err instanceof Error ? err.message : "Couldn't load chats." });
    }
  },

  upsert: (conversation) => {
    const current = get().conversations;
    const index = current.findIndex((c) => c.id === conversation.id);
    if (index === -1) {
      set({ conversations: [conversation, ...current] });
    } else {
      const next = current.slice();
      next[index] = conversation;
      set({ conversations: next });
    }
  },

  remove: (conversationId) => {
    const { [conversationId]: _dropped, ...pendingPasscodes } = get().pendingPasscodes;
    set({ conversations: get().conversations.filter((c) => c.id !== conversationId), pendingPasscodes });
  },

  removeMember: (conversationId, userId) => {
    set({
      conversations: get().conversations.map((c) =>
        c.id === conversationId ? { ...c, members: c.members.filter((m) => m.userId !== userId) } : c
      )
    });
  },

  setPendingPasscode: (conversationId, value) => {
    set({ pendingPasscodes: { ...get().pendingPasscodes, [conversationId]: value } });
  },

  takePendingPasscode: (conversationId) => {
    const value = get().pendingPasscodes[conversationId] ?? null;
    if (value) {
      const { [conversationId]: _taken, ...rest } = get().pendingPasscodes;
      set({ pendingPasscodes: rest });
    }
    return value;
  },

  reset: () => {
    loadSequence++;
    set({ ...initial, pendingPasscodes: {} });
  }
}));
