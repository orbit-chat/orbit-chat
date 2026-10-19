import { create } from "zustand";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { toChatMessage } from "./toChatMessage";

/** Matches the server's default page size; a shorter page means we've reached the start. */
export const PAGE_SIZE = 50;

type History = {
  loadingLatest: boolean;
  loadingOlder: boolean;
  /** False once a page comes back shorter than PAGE_SIZE. */
  hasOlder: boolean;
  error: string | null;
};

const empty: History = { loadingLatest: false, loadingOlder: false, hasOlder: true, error: null };

type HistoryState = {
  byConversation: Record<string, History>;
  /** Fetch the newest page and merge it into the cache. */
  loadLatest: (conversationId: string) => Promise<void>;
  /** Fetch the page before the oldest cached message. */
  loadOlder: (conversationId: string) => Promise<void>;
  reset: () => void;
};

export const useHistoryStore = create<HistoryState>((set, get) => {
  const patch = (conversationId: string, value: Partial<History>) =>
    set({ byConversation: { ...get().byConversation, [conversationId]: { ...(get().byConversation[conversationId] ?? empty), ...value } } });

  const store = (conversationId: string, messages: api.ServerMessage[]) => {
    const { upsertMessage } = useMessagesStore.getState();
    const currentUserId = useAuthStore.getState().user?.id;
    // Fetched history is never "new": the open conversation is being read right now.
    for (const message of messages) upsertMessage(conversationId, toChatMessage(message), { currentUserId, markAsRead: true });
  };

  return {
    byConversation: {},

    loadLatest: async (conversationId) => {
      const token = useAuthStore.getState().token;
      if (!token || get().byConversation[conversationId]?.loadingLatest) return;
      patch(conversationId, { loadingLatest: true, error: null });
      try {
        const page = await api.getMessages(conversationId, token);
        store(conversationId, page);
        const known = get().byConversation[conversationId];
        // Only the first load decides hasOlder; later refreshes keep what paging learned.
        patch(conversationId, { loadingLatest: false, hasOlder: known?.hasOlder === false ? false : page.length >= PAGE_SIZE });
      } catch (err) {
        patch(conversationId, { loadingLatest: false, error: err instanceof Error ? err.message : "Couldn't load messages." });
      }
    },

    loadOlder: async (conversationId) => {
      const token = useAuthStore.getState().token;
      const state = get().byConversation[conversationId] ?? empty;
      if (!token || state.loadingOlder || !state.hasOlder) return;
      const oldest = useMessagesStore.getState().byConversation[conversationId]?.[0];
      if (!oldest) return;
      patch(conversationId, { loadingOlder: true, error: null });
      try {
        const page = await api.getMessages(conversationId, token, oldest.id);
        store(conversationId, page);
        patch(conversationId, { loadingOlder: false, hasOlder: page.length >= PAGE_SIZE });
      } catch (err) {
        patch(conversationId, { loadingOlder: false, error: err instanceof Error ? err.message : "Couldn't load older messages." });
      }
    },

    reset: () => set({ byConversation: {} })
  };
});

export const useHistory = (conversationId: string) => useHistoryStore((s) => s.byConversation[conversationId] ?? empty);
