import type { QueryClient } from "@tanstack/react-query";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { usePrefsStore } from "../../stores/prefsStore";
import { useConversationsStore } from "../conversations/conversationsStore";
import { useDecryptedStore } from "../chat/decryptedStore";
import { resetMessageSigners } from "../chat/messageSigners";
import { useContactTrustStore } from "../chat/contactTrust";
import { useHistoryStore } from "../chat/historyStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useDraftsStore } from "../composer/draftsStore";
import { useOutboxStore } from "../composer/outboxStore";
import { useChatUiStore } from "../chat/chatUiStore";
import { usePresenceStore } from "../chat/presenceStore";

/**
 * Resets every piece of per-session state in one place, so nothing from the previous account
 * leaks into the next sign-in. Runs on sign-out and also when the session ends any other way
 * (expired refresh token, rejected socket auth), via useSessionLifecycle.
 */
export function resetSessionState(queryClient?: QueryClient) {
  usePrefsStore.getState().deactivate();
  useNavigationStore.getState().reset();
  useConversationsStore.getState().reset();
  // Drop decrypted plaintext from memory as soon as the session ends.
  useDecryptedStore.getState().reset();
  resetMessageSigners();
  useContactTrustStore.getState().reset();
  useHistoryStore.getState().reset();
  // Ciphertext and metadata (who, when, reactions) are cached in localStorage: not for the next account.
  useMessagesStore.getState().reset();
  useProfilesStore.getState().reset();
  useDraftsStore.getState().reset();
  // A pending message must never be retried under the next account.
  useOutboxStore.getState().reset();
  usePresenceStore.getState().reset();
  useChatUiStore.getState().reset();
  queryClient?.clear();
}

/**
 * Ends the session. The socket disconnects on its own when the token clears (see
 * useSessionLifecycle); conversation keys are dropped by clearSession.
 */
export function signOut(queryClient?: QueryClient) {
  useChatLockStore.getState().onLogout();
  // End the session on the server too (refresh token, sockets, pushes); best effort, offline is fine.
  const token = useAuthStore.getState().token;
  if (token) void api.logout(token).catch(() => undefined);
  useAuthStore.getState().clearSession();
  resetSessionState(queryClient);
}
