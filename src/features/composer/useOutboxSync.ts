import { useEffect } from "react";
import { useSocketStore } from "../../stores/socketStore";
import { errorLikelyFrom } from "../chat/socketActions";
import { useOutboxStore, type SendError } from "./outboxStore";

/** Confirms pending messages when the server echoes them, and fails one when it reports an error. */
export function useOutboxSync() {
  const socket = useSocketStore((s) => s.socket);

  useEffect(() => {
    if (!socket) return;
    const onNewMessage = (data: { id: string; conversationId: string; ciphertext: string }) => useOutboxStore.getState().confirm(data);
    const onError = (data: SendError | undefined) => {
      // Errors from reactions, pins or receipts must not fail a pending message. A key error
      // code (with its conversation) only ever comes from a refused send.
      if (!data?.code && !errorLikelyFrom("send_message")) return;
      useOutboxStore.getState().handleSendError(data ?? {});
    };
    socket.on("new_message", onNewMessage);
    socket.on("error", onError);
    return () => {
      socket.off("new_message", onNewMessage);
      socket.off("error", onError);
    };
  }, [socket]);
}
