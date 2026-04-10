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
  /** Attempt to silently refresh the access token using the stored refresh token */
  silentRefresh: () => Promise<boolean>;
};

/* ─── Proactive token refresh scheduler ─── */

let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Decode JWT payload without verification (client-side only) */
function decodeJwtPayload(jwt: string): { exp?: number } | null {
  try {
    const base64 = jwt.split(".")[1];
    if (!base64) return null;
    return JSON.parse(atob(base64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

/** Schedule a silent refresh ~80 % through the token's lifetime */
function scheduleRefresh(accessToken: string) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = null;

  const payload = decodeJwtPayload(accessToken);
  if (!payload?.exp) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const remainingSec = payload.exp - nowSec;
  // Refresh when 80 % of lifetime has elapsed (i.e. with 20 % remaining)
  const delayMs = Math.max(remainingSec * 0.8, 10) * 1000;

  _refreshTimer = setTimeout(() => {
    useAuthStore.getState().silentRefresh();
  }, delayMs);
}

function cancelRefresh() {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  refreshToken: null,
  user: null,
  loading: false,
  error: null,
  pendingRecoveryCodes: null,

  clearPendingRecoveryCodes: () => set({ pendingRecoveryCodes: null }),

  setSession: (token, user, refreshToken) => {
    set({ token, user, refreshToken: refreshToken ?? null, error: null });
    scheduleRefresh(token);
  },

  clearSession: () => {
    cancelRefresh();
    set({ token: null, refreshToken: null, user: null, error: null, pendingRecoveryCodes: null });
  },

  silentRefresh: async () => {
    const { refreshToken: rt, user } = get();
    if (!rt || !user) return false;
    try {
      const res = await api.refreshToken(rt);
      set({ token: res.accessToken, refreshToken: res.refreshToken });
      scheduleRefresh(res.accessToken);
      return true;
    } catch {
      // Refresh token is invalid/expired — force re-login
      cancelRefresh();
      set({ token: null, refreshToken: null, user: null, error: "Session expired. Please sign in again." });
      return false;
    }
  },

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
      scheduleRefresh(res.accessToken);
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
      scheduleRefresh(res.accessToken);
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
      scheduleRefresh(res.accessToken);
    } catch (err: any) {
      set({ loading: false, error: err.message ?? "Signup failed" });
    }
  },
}));
