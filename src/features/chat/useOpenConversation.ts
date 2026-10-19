import { useEffect } from "react";
import { useSocketStore } from "../../stores/socketStore";
import { useHistoryStore } from "./historyStore";

/**
 * While a conversation is open (and unlocked): fetch its newest messages and join its
 * socket room. Rejoins after a reconnect, since rooms don't survive one, and refetches
 * so anything missed while offline appears.
 */
export function useOpenConversation(conversationId: string, unlocked: boolean) {
  const socket = useSocketStore((s) => s.socket);
  const connected = useSocketStore((s) => s.connectionState === "connected");

  useEffect(() => {
    if (!unlocked) return;
    void useHistoryStore.getState().loadLatest(conversationId);
  }, [conversationId, unlocked, connected]);

  useEffect(() => {
    if (!unlocked || !socket || !connected) return;
    socket.emit("join_conversation", { conversationId });
  }, [conversationId, unlocked, socket, connected]);
}
