import { create } from "zustand";
import * as api from "../lib/api";
import { generateKeypair } from "../lib/crypto";

type User = {
  id: string;
  username: string;
  email?: string;
};

type AuthState = {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  setSession: (token: string, user: User, refreshToken?: string) => void;
  clearSession: () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, username: string, password: string) => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  refreshToken: null,
  user: null,
  loading: false,
  error: null,

  setSession: (token, user, refreshToken) =>
    set({ token, user, refreshToken: refreshToken ?? null, error: null }),

  clearSession: () =>
    set({ token: null, refreshToken: null, user: null, error: null }),

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await api.login({ email, password, deviceName: "Orbit Desktop" });
      set({
        token: res.accessToken,
        refreshToken: res.refreshToken,
        user: { id: res.user.id, username: res.user.username, email: res.user.email },
        loading: false,
      });
    } catch (err: any) {
      set({ loading: false, error: err.message ?? "Login failed" });
    }
  },

  signup: async (email, username, password) => {
    set({ loading: true, error: null });
    try {
      const keypair = await generateKeypair();
      const res = await api.signup({
        email,
        username,
        password,
        publicKey: keypair.publicKey,
        deviceName: "Orbit Desktop",
      });
      // Store private key locally for E2EE (in a real app, persist this securely)
      localStorage.setItem(`orbit:privateKey:${res.user.id}`, keypair.privateKey);
      set({
        token: res.accessToken,
        refreshToken: res.refreshToken,
        user: { id: res.user.id, username: res.user.username, email: res.user.email },
        loading: false,
      });
    } catch (err: any) {
      set({ loading: false, error: err.message ?? "Signup failed" });
    }
  },
}));
