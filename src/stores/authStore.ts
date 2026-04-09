import { create } from "zustand";
import * as api from "../lib/api";
import { generateKeypair } from "../lib/crypto";

type User = {
  id: string;
  username: string;
};

type AuthState = {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  /** Recovery codes shown once after signup */
  pendingRecoveryCodes: string[] | null;
  clearPendingRecoveryCodes: () => void;
  setSession: (token: string, user: User, refreshToken?: string) => void;
  clearSession: () => void;
  login: (username: string, password: string) => Promise<void>;
  loginWithRecoveryCode: (username: string, recoveryCode: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  refreshToken: null,
  user: null,
  loading: false,
  error: null,
  pendingRecoveryCodes: null,

  clearPendingRecoveryCodes: () => set({ pendingRecoveryCodes: null }),

  setSession: (token, user, refreshToken) =>
    set({ token, user, refreshToken: refreshToken ?? null, error: null }),

  clearSession: () =>
    set({ token: null, refreshToken: null, user: null, error: null, pendingRecoveryCodes: null }),

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const res = await api.login({ username, password, deviceName: "Orbit Desktop" });
      // Ensure this device has a keypair for E2EE.
      const privateKeyStorageKey = `orbit:privateKey:${res.user.id}`;
      const existingPrivateKey = localStorage.getItem(privateKeyStorageKey);
      if (!existingPrivateKey) {
        const keypair = await generateKeypair();
        await api.addMyPublicKey(keypair.publicKey, res.accessToken);
        localStorage.setItem(privateKeyStorageKey, keypair.privateKey);
      }
      set({
        token: res.accessToken,
        refreshToken: res.refreshToken,
        user: { id: res.user.id, username: res.user.username },
        loading: false,
      });
    } catch (err: any) {
      set({ loading: false, error: err.message ?? "Login failed" });
    }
  },

  loginWithRecoveryCode: async (username, recoveryCode) => {
    set({ loading: true, error: null });
    try {
      const res = await api.loginWithRecoveryCode({
        username,
        recoveryCode,
        deviceName: "Orbit Desktop",
      });
      // Ensure this device has a keypair for E2EE.
      const privateKeyStorageKey = `orbit:privateKey:${res.user.id}`;
      const existingPrivateKey = localStorage.getItem(privateKeyStorageKey);
      if (!existingPrivateKey) {
        const keypair = await generateKeypair();
        await api.addMyPublicKey(keypair.publicKey, res.accessToken);
        localStorage.setItem(privateKeyStorageKey, keypair.privateKey);
      }
      set({
        token: res.accessToken,
        refreshToken: res.refreshToken,
        user: { id: res.user.id, username: res.user.username },
        loading: false,
      });
    } catch (err: any) {
      set({ loading: false, error: err.message ?? "Recovery code login failed" });
    }
  },

  signup: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const keypair = await generateKeypair();
      const res = await api.signup({
        username,
        password,
        publicKey: keypair.publicKey,
        deviceName: "Orbit Desktop",
      });
      // Store private key locally for E2EE
      localStorage.setItem(`orbit:privateKey:${res.user.id}`, keypair.privateKey);
      set({
        token: res.accessToken,
        refreshToken: res.refreshToken,
        user: { id: res.user.id, username: res.user.username },
        pendingRecoveryCodes: res.recoveryCodes ?? null,
        loading: false,
      });
    } catch (err: any) {
      set({ loading: false, error: err.message ?? "Signup failed" });
    }
  },
}));
