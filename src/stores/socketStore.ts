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

function isAuthSocketError(message?: string | null) {
  if (!message) return false;
  return /(unauthor|forbidden|jwt|token|auth)/i.test(message);
}

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
      } else {
        // Token was refreshed while connected — force reconnect so the server
        // validates the new JWT and re-attaches rooms / presence.
        existing.disconnect();
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
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    set({ connectionState: "connecting", connectionError: null });

    socket.on("connect", () => set({ connected: true, connectionState: "connected", connectionError: null }));
    socket.on("disconnect", () => set({ connected: false, connectionState: "disconnected" }));
    socket.on("connect_error", async (err: Error) => {
      const message = err?.message ?? "Socket connection failed";
      if (isAuthSocketError(message)) {
        // Try a silent token refresh before giving up
        const refreshed = await useAuthStore.getState().silentRefresh?.();
        if (refreshed) {
          const newToken = useAuthStore.getState().token;
          if (newToken) {
            socket.auth = { token: newToken };
            // Let socket.io's built-in reconnection retry with the fresh token
            return;
          }
        }
        // Refresh failed — session is truly dead
        socket.io.opts.reconnection = false;
        socket.disconnect();
        useAuthStore.getState().clearSession();
        set({
          socket: null,
          connected: false,
          connectionState: "error",
          connectionError: "Session expired or invalid. Please sign in again.",
        });
        return;
      }

      set({ connected: false, connectionState: "error", connectionError: message });
    });
    socket.io.on("reconnect_error", async (err: Error) => {
      const message = err?.message ?? "Socket reconnect failed";
      if (isAuthSocketError(message)) {
        const refreshed = await useAuthStore.getState().silentRefresh?.();
        if (refreshed) {
          const newToken = useAuthStore.getState().token;
          if (newToken) {
            socket.auth = { token: newToken };
            return;
          }
        }
        socket.io.opts.reconnection = false;
        socket.disconnect();
        useAuthStore.getState().clearSession();
        set({
          socket: null,
          connected: false,
          connectionState: "error",
          connectionError: "Session expired or invalid. Please sign in again.",
        });
        return;
      }

      set({ connected: false, connectionState: "error", connectionError: message });
    });
    socket.io.on("reconnect_attempt", () => {
      set((prev) => {
        // Preserve visible errors instead of masking them as endless "connecting".
        if (prev.connectionState === "error") {
          return prev;
        }
        return { connectionState: "connecting", connectionError: prev.connectionError };
      });
    });
    socket.io.on("reconnect_failed", () => {
      set({
        connected: false,
        connectionState: "error",
        connectionError: "Unable to reconnect to realtime server. Check server status and VITE_SOCKET_URL.",
      });
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
