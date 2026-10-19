import { useEffect } from "react";
import { useAuthStore } from "../stores/authStore";
import { usePrefsStore } from "../stores/prefsStore";
import { useProfilesStore } from "../stores/profilesStore";
import { useSocketStore } from "../stores/socketStore";

/**
 * Side effects tied to being signed in: the realtime socket follows the access
 * token (reconnecting with the new JWT after a refresh), prefs switch to the
 * signed-in account, and the own profile is loaded for the account menu.
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

  useEffect(() => {
    if (!userId) return;
    usePrefsStore.getState().activate(userId);
    const currentToken = useAuthStore.getState().token;
    if (currentToken) void useProfilesStore.getState().fetchMe(currentToken, userId);
  }, [userId]);
}
