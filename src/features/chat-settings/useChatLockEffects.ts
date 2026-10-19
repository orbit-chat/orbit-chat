import { useEffect } from "react";
import { useChatLockStore } from "../../stores/chatLockStore";
import type { Conversation } from "../conversations/conversationsStore";
import { useConversationsStore } from "../conversations/conversationsStore";
import { usePasscodeRevealStore } from "./passcodeRevealStore";

/**
 * Per open chat: hand a pending one-time passcode (sent by the server when someone
 * secured the chat) to the reveal dialog, and keep the inactivity timer alive while
 * you're using an "after inactivity" chat.
 */
export function useChatLockEffects(conversation: Conversation | undefined, unlocked: boolean) {
  const conversationId = conversation?.id;

  useEffect(() => {
    if (!conversationId) return;
    const pending = useConversationsStore.getState().takePendingPasscode(conversationId);
    if (pending) usePasscodeRevealStore.getState().show({ conversationId, ...pending });
  }, [conversationId]);

  const inactivityMode = conversation?.lockMode === "after_inactivity";
  useEffect(() => {
    if (!conversationId || !unlocked || !inactivityMode) return;
    let last = 0;
    const onActivity = () => {
      // Pointer moves fire constantly; resetting a timer a few times a second is plenty.
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      useChatLockStore.getState().resetInactivity(conversationId);
    };
    const events = ["keydown", "pointermove", "pointerdown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
    };
  }, [conversationId, unlocked, inactivityMode]);
}
