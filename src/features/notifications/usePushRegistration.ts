import { useEffect } from "react";
import * as api from "../../lib/api";
import { devLog } from "../../lib/devLogger";
import { getPlatform } from "../../platform";
import { useAuthStore } from "../../stores/authStore";
import { useUserPrefs } from "../../stores/prefsStore";

/**
 * Phones get a content-free "New message" push while the app is in the background (mobile plan
 * M4). The server can't read messages, so it can't honour "mentions only": push is on only in
 * "all" mode, and muted chats are skipped by sending their IDs with the registration.
 */
export function pushWanted(mode: "all" | "mentions" | "off") {
  return mode === "all";
}

const REGISTER_DEBOUNCE_MS = 1500;

export function usePushRegistration() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const prefs = useUserPrefs();
  const mode = prefs.notifications.mode;
  const muted = prefs.mutedConversationIds.join(",");

  useEffect(() => {
    const pushToken = getPlatform().pushToken;
    if (!userId || !pushToken) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const token = useAuthStore.getState().token;
      if (!token || cancelled) return;
      try {
        if (!pushWanted(mode)) {
          await api.unregisterPush(token);
          return;
        }
        const device = await pushToken();
        if (!device || cancelled) return;
        await api.registerPush({ ...device, mutedConversationIds: muted ? muted.split(",") : [] }, token);
      } catch (err) {
        devLog.warn(`Push registration failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, REGISTER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, mode, muted]);
}
