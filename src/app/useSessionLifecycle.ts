import { useEffect, useRef } from "react";
import { resetSessionState } from "../features/auth/signOut";
import { useChatLockStore } from "../stores/chatLockStore";
import { useAuthStore } from "../stores/authStore";
import { usePrefsStore } from "../stores/prefsStore";
import { useProfilesStore } from "../stores/profilesStore";
import { useSocketStore } from "../stores/socketStore";

/**
 * Side effects tied to being signed in: the realtime socket follows the access
 * token (reconnecting with the new JWT after a refresh), prefs switch to the
 * signed-in account, the own profile is loaded for the account menu, and per-session state is
 * cleared when the session ends.
 */
export function useSessionLifecycle() {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);

  useEffect(() => {
    if (!token) {
      disconnect();
      return;
    }
    connect(token);
  }, [token, connect, disconnect]);

  // Disconnect only when the app unmounts, not on every token refresh.
  useEffect(() => () => disconnect(), [disconnect]);

  // The session ended without an explicit sign-out (expired refresh token, rejected socket auth):
  // clear it the same way, so decrypted messages and pending sends don't outlive it.
  const previousUserId = useRef<string | null>(null);
  useEffect(() => {
    if (previousUserId.current && !userId) {
      useChatLockStore.getState().onLogout();
      resetSessionState();
    }
    previousUserId.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    usePrefsStore.getState().activate(userId);
    const currentToken = useAuthStore.getState().token;
    if (currentToken) void useProfilesStore.getState().fetchMe(currentToken, userId);
  }, [userId]);
}
