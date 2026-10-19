import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ChatRealtimePreferences = {
  readReceipts: boolean;
  typingIndicators: boolean;
};

export const DEFAULT_CHAT_REALTIME: ChatRealtimePreferences = {
  readReceipts: true,
  typingIndicators: true
};

export type UserPrefs = {
  archivedConversationIds: string[];
  pinnedConversationIds: string[];
  chatRealtime: Record<string, ChatRealtimePreferences>;
  recentEmojis: string[];
};

const RECENT_EMOJI_LIMIT = 16;
export const PREFS_STORAGE_KEY = "orbit:prefs:v1";

/** Keys written by the old UI. Read once for migration, never written or deleted (the old UI still runs). */
export const LEGACY_KEYS = {
  archived: "orbit:archived",
  pinned: "orbit:pinned-chats",
  chatRealtime: "orbit:chat-realtime-preferences",
  recentEmojis: "orbit_recent_emojis"
} as const;

export function emptyPrefs(): UserPrefs {
  return { archivedConversationIds: [], pinnedConversationIds: [], chatRealtime: {}, recentEmojis: [] };
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Builds prefs from the old UI's shared (not per-user) localStorage keys. */
export function readLegacyPrefs(): UserPrefs {
  const chatRealtime: Record<string, ChatRealtimePreferences> = {};
  const rawRealtime = readJson(LEGACY_KEYS.chatRealtime);
  if (rawRealtime && typeof rawRealtime === "object" && !Array.isArray(rawRealtime)) {
    for (const [conversationId, pref] of Object.entries(rawRealtime as Record<string, Partial<ChatRealtimePreferences>>)) {
      chatRealtime[conversationId] = {
        readReceipts: pref?.readReceipts ?? true,
        typingIndicators: pref?.typingIndicators ?? true
      };
    }
  }
  return {
    archivedConversationIds: stringArray(readJson(LEGACY_KEYS.archived)),
    pinnedConversationIds: stringArray(readJson(LEGACY_KEYS.pinned)),
    chatRealtime,
    recentEmojis: stringArray(readJson(LEGACY_KEYS.recentEmojis)).slice(0, RECENT_EMOJI_LIMIT)
  };
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

type PrefsState = {
  /** Signed-in user whose prefs the actions read and write. */
  userId: string | null;
  byUser: Record<string, UserPrefs>;
  /** The old UI's keys were shared by every account, so only the first account to sign in inherits them. */
  legacyImported: boolean;

  /** Call on sign-in. Creates the user's prefs (importing legacy data once) if missing. */
  activate: (userId: string) => void;
  /** Call on sign-out. Prefs stay saved for next time. */
  deactivate: () => void;
  toggleArchived: (conversationId: string) => void;
  togglePinned: (conversationId: string) => void;
  setChatRealtime: (conversationId: string, patch: Partial<ChatRealtimePreferences>) => void;
  pushRecentEmoji: (emoji: string) => void;
  /** Remove a deleted/left conversation from every list. */
  forgetConversation: (conversationId: string) => void;
};

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set, get) => {
      /** Applies `fn` to the active user's prefs; no-op when signed out. */
      const update = (fn: (prefs: UserPrefs) => UserPrefs) => {
        const { userId, byUser } = get();
        if (!userId) return;
        set({ byUser: { ...byUser, [userId]: fn(byUser[userId] ?? emptyPrefs()) } });
      };

      return {
        userId: null,
        byUser: {},
        legacyImported: false,

        activate: (userId) => {
          const state = get();
          if (state.byUser[userId]) {
            set({ userId });
            return;
          }
          const prefs = state.legacyImported ? emptyPrefs() : readLegacyPrefs();
          set({ userId, byUser: { ...state.byUser, [userId]: prefs }, legacyImported: true });
        },

        deactivate: () => set({ userId: null }),

        toggleArchived: (conversationId) =>
          update((prefs) => ({ ...prefs, archivedConversationIds: toggle(prefs.archivedConversationIds, conversationId) })),

        togglePinned: (conversationId) =>
          update((prefs) => ({ ...prefs, pinnedConversationIds: toggle(prefs.pinnedConversationIds, conversationId) })),

        setChatRealtime: (conversationId, patch) =>
          update((prefs) => ({
            ...prefs,
            chatRealtime: {
              ...prefs.chatRealtime,
              [conversationId]: { ...(prefs.chatRealtime[conversationId] ?? DEFAULT_CHAT_REALTIME), ...patch }
            }
          })),

        pushRecentEmoji: (emoji) =>
          update((prefs) => ({
            ...prefs,
            recentEmojis: [emoji, ...prefs.recentEmojis.filter((value) => value !== emoji)].slice(0, RECENT_EMOJI_LIMIT)
          })),

        forgetConversation: (conversationId) =>
          update((prefs) => {
            const { [conversationId]: _removed, ...chatRealtime } = prefs.chatRealtime;
            return {
              ...prefs,
              archivedConversationIds: prefs.archivedConversationIds.filter((id) => id !== conversationId),
              pinnedConversationIds: prefs.pinnedConversationIds.filter((id) => id !== conversationId),
              chatRealtime
            };
          })
      };
    },
    {
      name: PREFS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // The active user comes from the auth session, not from disk.
      partialize: ({ byUser, legacyImported }) => ({ byUser, legacyImported })
    }
  )
);

const EMPTY = emptyPrefs();

/** Active user's prefs (stable empty object when signed out). */
export const useUserPrefs = () => usePrefsStore((state) => (state.userId ? state.byUser[state.userId] ?? EMPTY : EMPTY));

export const useChatRealtime = (conversationId: string | null) =>
  usePrefsStore((state) => {
    if (!state.userId || !conversationId) return DEFAULT_CHAT_REALTIME;
    return state.byUser[state.userId]?.chatRealtime[conversationId] ?? DEFAULT_CHAT_REALTIME;
  });
