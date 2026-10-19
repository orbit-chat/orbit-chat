import { useEffect } from "react";
import { useSocketStore } from "../../stores/socketStore";
import { errorLikelyFrom } from "../chat/socketActions";
import { useOutboxStore } from "./outboxStore";

/** Confirms pending messages when the server echoes them, and fails one when it reports an error. */
export function useOutboxSync() {
  const socket = useSocketStore((s) => s.socket);

  useEffect(() => {
    if (!socket) return;
    const onNewMessage = (data: { id: string; conversationId: string; ciphertext: string }) => useOutboxStore.getState().confirm(data);
    const onError = (data: { message?: string }) => {
      // Errors from reactions, pins or receipts must not fail a pending message.
      if (!errorLikelyFrom("send_message")) return;
      useOutboxStore.getState().failOldestSending(data?.message ?? "The server rejected this message.");
    };
    socket.on("new_message", onNewMessage);
    socket.on("error", onError);
    return () => {
      socket.off("new_message", onNewMessage);
      socket.off("error", onError);
    };
  }, [socket]);
}
