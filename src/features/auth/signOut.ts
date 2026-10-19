import type { QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../../stores/authStore";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { usePrefsStore } from "../../stores/prefsStore";

/**
 * Ends the session and resets every piece of per-session UI state in one place,
 * so nothing from the previous account leaks into the next sign-in.
 * The socket disconnects on its own when the token clears (see useSessionLifecycle).
 */
export function signOut(queryClient?: QueryClient) {
  useChatLockStore.getState().onLogout();
  useAuthStore.getState().clearSession();
  usePrefsStore.getState().deactivate();
  useNavigationStore.getState().reset();
  queryClient?.clear();
}
