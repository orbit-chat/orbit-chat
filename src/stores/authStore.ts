import { create } from "zustand";
import * as api from "../lib/api";
import { generateKeypair } from "../lib/crypto";
import { devLog } from "../lib/devLogger";
import { decodeJwtPayload } from "../lib/jwt";
import { getInstallId, getPlatform, isMobile } from "../platform";
import { devicePrivateKeyStorageKey, useE2EEStore } from "./e2eeStore";

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
  /** Dismiss the last auth error (e.g. when switching between login and signup). */
  clearError: () => void;
  setSession: (token: string, user: User, refreshToken?: string) => void;
  clearSession: () => void;
  login: (username: string, password: string) => Promise<void>;
  loginWithRecoveryCode: (username: string, recoveryCode: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  /** Attempt to silently refresh the access token using the stored refresh token */
  silentRefresh: () => Promise<boolean>;
  /** Phones: sign back in with the refresh token kept in the Keychain/Keystore. True if it worked. */
  restoreSession: () => Promise<boolean>;
};

/**
 * Phones stay signed in (mobile plan M3): the refresh token is kept in the platform's secure
 * store (Keychain / Android Keystore), never in localStorage. Desktop keeps signing in on every
 * launch, as before. Refresh tokens rotate, so every refresh rewrites it.
 */
const SESSION_KEY = "orbit:session";

async function persistSession(refreshToken: string, user: User) {
  if (!isMobile()) return;
  await getPlatform().secureStore.set(SESSION_KEY, JSON.stringify({ refreshToken, user: { id: user.id, username: user.username } }));
}

async function forgetPersistedSession() {
  if (!isMobile()) return;
  await getPlatform().secureStore.remove(SESSION_KEY).catch(() => undefined);
}

/* ─── Proactive token refresh scheduler ─── */

let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

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

/**
 * Put this device on the user's signed device list (mobile plan B6), learn which key protocol the
 * server runs, and with per-device keys move this device's legacy keys over once (M1b). Runs in
 * the background and never fails sign-in: older servers don't have the endpoints, and a device
 * that isn't linked yet still signs in (it just can't read chats until it is).
 */
export async function syncDeviceIdentity(userId: string, accessToken: string) {
  const e2ee = useE2EEStore.getState();
  try {
    const [status, perDevice] = await Promise.all([
      e2ee.ensureDeviceIdentity(userId, accessToken, { force: true }),
      e2ee.ensureKeyMode(userId),
    ]);
    if (status === "trusted" && perDevice) {
      await e2ee.migrateLegacyKeys(userId, accessToken);
      // Finish sharing history with a device this one linked, if a past session was interrupted.
      const { resumeHistoryShares } = await import("../features/devices/shareHistory");
      await resumeHistoryShares(userId, accessToken);
    }
  } catch (err) {
    devLog.warn(`Device identity sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
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

  clearError: () => set({ error: null }),

  setSession: (token, user, refreshToken) => {
    set({ token, user, refreshToken: refreshToken ?? null, error: null });
    scheduleRefresh(token);
    if (refreshToken) void persistSession(refreshToken, user).catch(() => undefined);
  },

  clearSession: () => {
    cancelRefresh();
    void forgetPersistedSession();
    // Conversation keys and device status belong to the session that's ending.
    useE2EEStore.getState().reset();
    set({ token: null, refreshToken: null, user: null, error: null, pendingRecoveryCodes: null });
  },

  silentRefresh: async () => {
    const { refreshToken: rt, user } = get();
    if (!rt || !user) return false;
    try {
      const res = await api.refreshToken(rt);
      set({ token: res.accessToken, refreshToken: res.refreshToken });
      scheduleRefresh(res.accessToken);
      await persistSession(res.refreshToken, user).catch(() => undefined);
      return true;
    } catch {
      // Refresh token is invalid/expired — force re-login
      cancelRefresh();
      void forgetPersistedSession();
      useE2EEStore.getState().reset();
      set({ token: null, refreshToken: null, user: null, error: "Session expired. Please sign in again." });
      return false;
    }
  },

  restoreSession: async () => {
    if (!isMobile() || get().user) return false;
    let saved: { refreshToken?: unknown; user?: { id?: unknown; username?: unknown } } | null = null;
    try {
      const raw = await getPlatform().secureStore.get(SESSION_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      return false;
    }
    const refreshToken = saved?.refreshToken;
    const user = saved?.user;
    if (typeof refreshToken !== "string" || typeof user?.id !== "string" || typeof user.username !== "string") return false;
    set({ loading: true, error: null });
    try {
      const res = await api.refreshToken(refreshToken);
      await useE2EEStore.getState().ensureDeviceKeypair(user.id, res.accessToken);
      get().setSession(res.accessToken, { id: user.id, username: user.username }, res.refreshToken);
      set({ loading: false });
      void syncDeviceIdentity(user.id, res.accessToken);
      return true;
    } catch (err) {
      // A refused token (signed out elsewhere, revoked) is gone for good; a network error isn't.
      if (err instanceof api.ApiError && (err.status === 401 || err.status === 403)) await forgetPersistedSession();
      set({ loading: false });
      return false;
    }
  },

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const res = await api.login({
        username,
        password,
        deviceName: getPlatform().deviceName,
        installId: await getInstallId(),
      });
      // Ensure this device has a keypair for E2EE.
      await useE2EEStore.getState().ensureDeviceKeypair(res.user.id, res.accessToken);
      get().setSession(res.accessToken, { id: res.user.id, username: res.user.username }, res.refreshToken);
      set({ loading: false });
      void syncDeviceIdentity(res.user.id, res.accessToken);
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
        deviceName: getPlatform().deviceName,
        installId: await getInstallId(),
      });
      // Ensure this device has a keypair for E2EE.
      await useE2EEStore.getState().ensureDeviceKeypair(res.user.id, res.accessToken);
      get().setSession(res.accessToken, { id: res.user.id, username: res.user.username }, res.refreshToken);
      set({ loading: false });
      void syncDeviceIdentity(res.user.id, res.accessToken);
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
        deviceName: getPlatform().deviceName,
        installId: await getInstallId(),
      });
      // Store private key locally for E2EE
      await getPlatform().secureStore.set(devicePrivateKeyStorageKey(res.user.id), keypair.privateKey);
      get().setSession(res.accessToken, { id: res.user.id, username: res.user.username }, res.refreshToken);
      set({ pendingRecoveryCodes: res.recoveryCodes ?? null, loading: false });
      void syncDeviceIdentity(res.user.id, res.accessToken);
    } catch (err: any) {
      set({ loading: false, error: err.message ?? "Signup failed" });
    }
  },
}));
