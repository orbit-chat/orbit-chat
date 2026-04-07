import { create } from "zustand";
import { io, Socket } from "socket.io-client";

type SocketState = {
  socket: Socket | null;
  connected: boolean;
  connect: (token: string) => void;
  disconnect: () => void;
};

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:3000";

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  connected: false,
  connect: (token) => {
    if (get().socket) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket"]
    });

    socket.on("connect", () => set({ connected: true }));
    socket.on("disconnect", () => set({ connected: false }));

    set({ socket });
  },
  disconnect: () => {
    const socket = get().socket;
    if (!socket) return;
    socket.disconnect();
    set({ socket: null, connected: false });
  }
}));
