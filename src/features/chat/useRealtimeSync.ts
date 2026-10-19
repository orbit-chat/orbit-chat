import { useEffect, useRef } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { usePrefsStore, DEFAULT_CHAT_REALTIME } from "../../stores/prefsStore";
import { useSocketStore } from "../../stores/socketStore";
import { usePresenceStore } from "./presenceStore";
import { markSeen } from "./socketActions";

function prefsFor(conversationId: string) {
  const prefs = usePrefsStore.getState();
  const user = prefs.userId ? prefs.byUser[prefs.userId] : undefined;
  return user?.chatRealtime[conversationId] ?? DEFAULT_CHAT_REALTIME;
}

/** Other people's typing and read receipts, from the socket into presenceStore. */
export function useRealtimeSync() {
  const socket = useSocketStore((s) => s.socket);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!socket || !myUserId) return;
    const onTypingStart = (data: { userId: string; conversationId: string }) => {
      if (data.userId === myUserId || !prefsFor(data.conversationId).typingIndicators) return;
      usePresenceStore.getState().startTyping(data.conversationId, data.userId);
    };
    const onTypingStop = (data: { userId: string; conversationId: string }) => usePresenceStore.getState().stopTyping(data.conversationId, data.userId);
    const onSeen = (data: { messageId: string; userId: string }) => {
      if (data.userId !== myUserId) usePresenceStore.getState().markSeenBy(data.messageId, data.userId);
    };
    // A new message from someone ends their typing indicator immediately.
    const onNewMessage = (data: { conversationId: string; senderId: string }) => usePresenceStore.getState().stopTyping(data.conversationId, data.senderId);

    socket.on("typing_start", onTypingStart);
    socket.on("typing_stop", onTypingStop);
    socket.on("message_seen", onSeen);
    socket.on("new_message", onNewMessage);
    return () => {
      socket.off("typing_start", onTypingStart);
      socket.off("typing_stop", onTypingStop);
      socket.off("message_seen", onSeen);
      socket.off("new_message", onNewMessage);
    };
  }, [socket, myUserId]);
}

/**
 * While a chat is open and the window is visible, tell the server you've seen the newest
 * message from someone else. One receipt covers everything before it, so this sends one
 * per new message instead of one per message in the history (as the old client did).
 */
export function useSeenReceipts(conversationId: string, enabled: boolean) {
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const newestFromOthers = useMessagesStore((s) => {
    const list = s.byConversation[conversationId];
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.senderId !== myUserId) return list[i]!.id;
    return null;
  });
  const readReceipts = usePrefsStore((s) => (s.userId ? s.byUser[s.userId]?.chatRealtime[conversationId]?.readReceipts : undefined) ?? true);
  const connected = useSocketStore((s) => s.connectionState === "connected");
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !readReceipts || !newestFromOthers || !connected) return;
    const send = () => {
      // Once per message: reconnect flips and re-renders shouldn't resend it.
      if (document.visibilityState !== "visible" || lastSent.current === newestFromOthers) return;
      lastSent.current = newestFromOthers;
      markSeen(conversationId, newestFromOthers);
    };
    send();
    // If it arrived while the window was hidden, send when it comes back.
    document.addEventListener("visibilitychange", send);
    return () => document.removeEventListener("visibilitychange", send);
  }, [conversationId, enabled, readReceipts, newestFromOthers, connected]);
}
