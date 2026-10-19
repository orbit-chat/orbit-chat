import { useCallback, useEffect, useRef } from "react";
import { useChatRealtime } from "../../stores/prefsStore";
import { useSocketStore } from "../../stores/socketStore";

/** Stop announcing typing after this long without a keystroke. */
export const TYPING_IDLE_MS = 3000;

/**
 * Tells the conversation you're typing: one `typing_start` when you begin, `typing_stop`
 * after a pause, on send, when you clear the box, or when you leave the chat. Silent if
 * you've turned typing indicators off for this chat.
 */
export function useTypingSignals(conversationId: string) {
  const { typingIndicators } = useChatRealtime(conversationId);
  const announced = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (!announced.current) return;
    announced.current = false;
    useSocketStore.getState().socket?.emit("typing_stop", { conversationId });
  }, [conversationId]);

  const onTextChange = useCallback(
    (text: string) => {
      if (!typingIndicators || !text.trim()) {
        stop();
        return;
      }
      if (!announced.current) {
        const socket = useSocketStore.getState().socket;
        if (!socket) return;
        socket.emit("typing_start", { conversationId });
        announced.current = true;
      }
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(stop, TYPING_IDLE_MS);
    },
    [conversationId, typingIndicators, stop]
  );

  // Leaving the chat (or turning indicators off) ends the signal.
  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!typingIndicators) stop();
  }, [typingIndicators, stop]);

  return { onTextChange, stop };
}
