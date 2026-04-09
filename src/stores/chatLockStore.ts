import { create } from "zustand";
import type { ChatLockMode } from "../lib/api";

type UnlockedEntry = {
  /** Timestamp (ms) when the chat was unlocked */
  unlockedAt: number;
  lockMode: ChatLockMode;
  lockTimeoutSeconds: number | null;
};

type ChatLockState = {
  /** Map of conversation ID → unlock info.  Only present while unlocked. */
  unlocked: Record<string, UnlockedEntry>;
  /** Active timer handles so we can clear them on re-lock or unmount. */
  _timers: Record<string, ReturnType<typeof setTimeout>>;

  /** Mark a conversation as unlocked and schedule auto-lock if applicable. */
  unlock: (conversationId: string, lockMode: ChatLockMode, lockTimeoutSeconds: number | null) => void;

  /** Immediately lock a conversation. */
  lock: (conversationId: string) => void;

  /** Called when the user navigates away from a conversation.
   *  Locks if mode is "on_leave". */
  onLeave: (conversationId: string) => void;

  /** Called when the user logs out – locks all "on_logout" conversations. */
  onLogout: () => void;

  /** Resets inactivity timer (pointer / keyboard events). */
  resetInactivity: (conversationId: string) => void;

  /** Whether a conversation is currently unlocked. */
  isUnlocked: (conversationId: string) => boolean;

  /** Returns true if the conversation requires a passcode at all. */
  needsPasscode: (passcodeEnabled: boolean) => boolean;
};

export const useChatLockStore = create<ChatLockState>((set, get) => ({
  unlocked: {},
  _timers: {},

  unlock: (conversationId, lockMode, lockTimeoutSeconds) => {
    // Clear any previous timer for this conversation
    const prevTimer = get()._timers[conversationId];
    if (prevTimer) clearTimeout(prevTimer);

    const entry: UnlockedEntry = {
      unlockedAt: Date.now(),
      lockMode,
      lockTimeoutSeconds,
    };

    let timerId: ReturnType<typeof setTimeout> | undefined;

    if (lockMode === "after_time" && lockTimeoutSeconds && lockTimeoutSeconds > 0) {
      timerId = setTimeout(() => {
        get().lock(conversationId);
      }, lockTimeoutSeconds * 1000);
    }

    if (lockMode === "after_inactivity" && lockTimeoutSeconds && lockTimeoutSeconds > 0) {
      timerId = setTimeout(() => {
        get().lock(conversationId);
      }, lockTimeoutSeconds * 1000);
    }

    set((state) => ({
      unlocked: { ...state.unlocked, [conversationId]: entry },
      _timers: timerId
        ? { ...state._timers, [conversationId]: timerId }
        : state._timers,
    }));
  },

  lock: (conversationId) => {
    const timer = get()._timers[conversationId];
    if (timer) clearTimeout(timer);

    set((state) => {
      const { [conversationId]: _, ...rest } = state.unlocked;
      const { [conversationId]: __, ...restTimers } = state._timers;
      return { unlocked: rest, _timers: restTimers };
    });
  },

  onLeave: (conversationId) => {
    const entry = get().unlocked[conversationId];
    if (!entry) return;
    if (entry.lockMode === "on_leave") {
      get().lock(conversationId);
    }
  },

  onLogout: () => {
    // Clear all timers
    const timers = get()._timers;
    for (const t of Object.values(timers)) clearTimeout(t);

    // Lock conversations that lock on logout (and on_leave ones should already be locked)
    const unlocked = get().unlocked;
    const remaining: Record<string, UnlockedEntry> = {};
    for (const [id, entry] of Object.entries(unlocked)) {
      // Keep only after_time and after_inactivity that are still ticking
      // Actually on logout we lock everything except... nothing. Lock all.
    }
    set({ unlocked: {}, _timers: {} });
  },

  resetInactivity: (conversationId) => {
    const entry = get().unlocked[conversationId];
    if (!entry) return;
    if (entry.lockMode !== "after_inactivity") return;
    if (!entry.lockTimeoutSeconds || entry.lockTimeoutSeconds <= 0) return;

    const prevTimer = get()._timers[conversationId];
    if (prevTimer) clearTimeout(prevTimer);

    const timerId = setTimeout(() => {
      get().lock(conversationId);
    }, entry.lockTimeoutSeconds * 1000);

    set((state) => ({
      _timers: { ...state._timers, [conversationId]: timerId },
    }));
  },

  isUnlocked: (conversationId) => {
    return conversationId in get().unlocked;
  },

  needsPasscode: (passcodeEnabled) => {
    return passcodeEnabled;
  },
}));
