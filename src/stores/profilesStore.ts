import { create } from "zustand";
import * as api from "../lib/api";

const profileLoadInFlight = new Map<string, Promise<api.UserProfile | null>>();

type ProfilesState = {
  byId: Record<string, api.UserProfile>;
  loadingById: Record<string, boolean>;
  errorById: Record<string, string | null>;

  fetchProfile: (userId: string, token: string) => Promise<api.UserProfile | null>;
  fetchMe: (token: string, myUserId?: string) => Promise<api.UserProfile | null>;

  updateMyProfile: (data: api.UpdateMyProfileInput, token: string, myUserId: string) => Promise<api.UserProfile | null>;
  uploadMyAvatar: (file: File, token: string, myUserId: string) => Promise<api.UserProfile | null>;
  uploadMyBanner: (file: File, token: string, myUserId: string) => Promise<api.UserProfile | null>;
};

export const useProfilesStore = create<ProfilesState>((set, get) => ({
  byId: {},
  loadingById: {},
  errorById: {},

  fetchProfile: async (userId, token) => {
    const cached = get().byId[userId];
    if (cached) return cached;

    const pending = profileLoadInFlight.get(userId);
    if (pending) return pending;

    const loadPromise = (async () => {
    set({
      loadingById: { ...get().loadingById, [userId]: true },
      errorById: { ...get().errorById, [userId]: null },
    });

    try {
      const profile = await api.getUser(userId, token);
      set({
        byId: { ...get().byId, [userId]: profile },
        loadingById: { ...get().loadingById, [userId]: false },
      });
      return profile;
    } catch (err: any) {
      set({
        loadingById: { ...get().loadingById, [userId]: false },
        errorById: { ...get().errorById, [userId]: err?.message ?? "Failed to load profile" },
      });
      return null;
    } finally {
      profileLoadInFlight.delete(userId);
    }
    })();

    profileLoadInFlight.set(userId, loadPromise);
    return loadPromise;
  },

  fetchMe: async (token, myUserId) => {
    // If we already have a cached profile for me, return it.
    if (myUserId && get().byId[myUserId]) return get().byId[myUserId];

    try {
      const me = await api.getMe(token);
      set({ byId: { ...get().byId, [me.id]: me } });
      return me;
    } catch {
      // Some backends might not have /users/me; fall back to cached state if any.
      if (myUserId) return get().byId[myUserId] ?? null;
      return null;
    }
  },

  updateMyProfile: async (data, token, myUserId) => {
    set({
      loadingById: { ...get().loadingById, [myUserId]: true },
      errorById: { ...get().errorById, [myUserId]: null },
    });

    try {
      const updated = await api.updateMyProfile(data, token);
      set({
        byId: { ...get().byId, [updated.id]: updated },
        loadingById: { ...get().loadingById, [myUserId]: false },
      });
      return updated;
    } catch (err: any) {
      set({
        loadingById: { ...get().loadingById, [myUserId]: false },
        errorById: { ...get().errorById, [myUserId]: err?.message ?? "Failed to update profile" },
      });
      return null;
    }
  },

  uploadMyAvatar: async (file, token, myUserId) => {
    set({
      loadingById: { ...get().loadingById, [myUserId]: true },
      errorById: { ...get().errorById, [myUserId]: null },
    });

    try {
      const updated = await api.uploadMyAvatar(file, token);
      set({
        byId: { ...get().byId, [updated.id]: updated },
        loadingById: { ...get().loadingById, [myUserId]: false },
      });
      return updated;
    } catch (err: any) {
      set({
        loadingById: { ...get().loadingById, [myUserId]: false },
        errorById: { ...get().errorById, [myUserId]: err?.message ?? "Failed to upload avatar" },
      });
      return null;
    }
  },

  uploadMyBanner: async (file, token, myUserId) => {
    set({
      loadingById: { ...get().loadingById, [myUserId]: true },
      errorById: { ...get().errorById, [myUserId]: null },
    });

    try {
      const updated = await api.uploadMyBanner(file, token);
      set({
        byId: { ...get().byId, [updated.id]: updated },
        loadingById: { ...get().loadingById, [myUserId]: false },
      });
      return updated;
    } catch (err: any) {
      set({
        loadingById: { ...get().loadingById, [myUserId]: false },
        errorById: { ...get().errorById, [myUserId]: err?.message ?? "Failed to upload banner" },
      });
      return null;
    }
  },
}));
