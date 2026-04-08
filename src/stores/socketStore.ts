import { create } from "zustand";
import { io, Socket } from "socket.io-client";
import { useMessagesStore } from "./messagesStore";

type SocketState = {
  socket: Socket | null;
  connected: boolean;
  connect: (token: string) => void;
  disconnect: () => void;
};

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? "http://147.135.31.128:3000";

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  connected: false,
  connect: (token) => {
    if (get().socket) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"]
    });

    socket.on("connect", () => set({ connected: true }));
    socket.on("disconnect", () => set({ connected: false }));

    // Wire incoming messages into the messages store
    socket.on("new_message", (data: {
      id: string;
      conversationId: string;
      sender: string;
      senderId: string;
      ciphertext: string;
      nonce: string;
      keyVersion: number;
      type: string;
      expiresAt: string | null;
      maxViews: number | null;
      createdAt: number;
    }) => {
      useMessagesStore.getState().upsertMessage(data.conversationId, {
        id: data.id,
        senderId: data.senderId,
        sender: data.sender,
        cipherText: data.ciphertext,
        createdAt: data.createdAt,
        nonce: data.nonce,
      });
    });

    socket.on("message_delivered", (data: { messageId: string; userId: string }) => {
      // Could update delivery status UI in the future
    });

    socket.on("message_seen", (data: { messageId: string; userId: string }) => {
      // Could update seen status UI in the future
    });

    set({ socket });
  },
  disconnect: () => {
    const socket = get().socket;
    if (!socket) return;
    socket.disconnect();
    set({ socket: null, connected: false });
  }
}));
