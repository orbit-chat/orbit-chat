import { create } from "zustand";
import { io, Socket } from "socket.io-client";
import { useMessagesStore } from "./messagesStore";
import { useAuthStore } from "./authStore";

type SocketState = {
  socket: Socket | null;
  connected: boolean;
  connectionState: "idle" | "connecting" | "connected" | "disconnected" | "error";
  connectionError: string | null;
  connect: (token: string) => void;
  disconnect: () => void;
};

function normalizeBaseUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  const fixedPort = trimmed.replace(/\/:(\d+)/, ":$1");
  return fixedPort.replace(/\/$/, "");
}

const SOCKET_URL = normalizeBaseUrl(import.meta.env.VITE_SOCKET_URL ?? "http://147.135.31.128:3000");

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  connected: false,
  connectionState: "idle",
  connectionError: null,
  connect: (token) => {
    const existing = get().socket;
    if (existing) {
      existing.auth = { token };
      if (!existing.connected) {
        set({ connectionState: "connecting", connectionError: null });
        existing.connect();
      }
      return;
    }

    const socket = io(SOCKET_URL, {
      auth: { token },
      // Start with polling for reliability behind proxies/firewalls, then upgrade to websocket.
      transports: ["polling", "websocket"],
      upgrade: true,
      rememberUpgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    set({ connectionState: "connecting", connectionError: null });

    socket.on("connect", () => set({ connected: true, connectionState: "connected", connectionError: null }));
    socket.on("disconnect", () => set({ connected: false, connectionState: "disconnected" }));
    socket.on("connect_error", (err: Error) => {
      set({ connected: false, connectionState: "error", connectionError: err?.message ?? "Socket connection failed" });
    });
    socket.io.on("reconnect_error", (err: Error) => {
      set({ connected: false, connectionState: "error", connectionError: err?.message ?? "Socket reconnect failed" });
    });
    socket.io.on("reconnect_attempt", () => {
      set((prev) => ({ connectionState: "connecting", connectionError: prev.connectionError }));
    });

    // Wire incoming messages into the messages store
    socket.on("new_message", (data: {
      id: string;
      conversationId: string;
      sender: string;
      senderId: string;
      ciphertext: string;
      nonce: string;
      keyVersion: number;
      mediaIds?: string[];
      type: string;
      expiresAt: string | null;
      maxViews: number | null;
      createdAt: number;
    }) => {
      const currentUserId = useAuthStore.getState().user?.id;
      useMessagesStore.getState().upsertMessage(data.conversationId, {
        id: data.id,
        senderId: data.senderId,
        sender: data.sender,
        cipherText: data.ciphertext,
        createdAt: data.createdAt,
        nonce: data.nonce,
        keyVersion: data.keyVersion,
        mediaIds: data.mediaIds ?? [],
      }, { currentUserId });
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
    set({ socket: null, connected: false, connectionState: "idle", connectionError: null });
  }
}));
