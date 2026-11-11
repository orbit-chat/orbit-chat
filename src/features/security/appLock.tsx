import { useEffect, useRef, type ReactNode } from "react";
import { create } from "zustand";
import { Button } from "../../ui";
import { LockIcon } from "../../ui/icons";
import { getPlatform } from "../../platform";

/**
 * App lock (mobile plan M5): an optional Face ID / Touch ID / fingerprint lock (device passcode
 * as fallback) over the whole app, applied at launch and every time the app comes back from the
 * background. A per-device setting, kept in localStorage so it's known synchronously at launch,
 * before a restored session could show anything.
 */

const APP_LOCK_KEY = "orbit:appLock";

function readEnabled() {
  try {
    return localStorage.getItem(APP_LOCK_KEY) === "1";
  } catch {
    return false;
  }
}

type AppLockState = {
  enabled: boolean;
  locked: boolean;
  setEnabled: (enabled: boolean) => void;
  lock: () => void;
  unlock: () => void;
};

export const useAppLockStore = create<AppLockState>((set, get) => ({
  enabled: readEnabled(),
  locked: readEnabled(),
  setEnabled: (enabled) => {
    try {
      if (enabled) localStorage.setItem(APP_LOCK_KEY, "1");
      else localStorage.removeItem(APP_LOCK_KEY);
    } catch {
      // Storage unavailable: the setting just won't survive a restart.
    }
    set({ enabled, locked: enabled && get().locked });
  },
  lock: () => {
    if (get().enabled) set({ locked: true });
  },
  unlock: () => set({ locked: false }),
}));

/** Turn the lock on only after the user proves the biometric works, so they can't lock themselves out. */
export async function enableAppLock(): Promise<boolean> {
  const biometric = getPlatform().biometric;
  if (!biometric || !(await biometric.available())) return false;
  if (!(await biometric.verify("Turn on the Orbit app lock"))) return false;
  useAppLockStore.getState().setEnabled(true);
  return true;
}

async function tryUnlock() {
  const biometric = getPlatform().biometric;
  if (!biometric) {
    // The lock can't be satisfied here (e.g. the setting came over from a build with biometrics):
    // don't trap the user.
    useAppLockStore.getState().unlock();
    return;
  }
  if (await biometric.verify("Unlock Orbit")) useAppLockStore.getState().unlock();
}

/** Covers the app while it's locked; locks again whenever the app goes to the background. */
export function AppLockGate({ children }: { children: ReactNode }) {
  const enabled = useAppLockStore((s) => s.enabled);
  const locked = useAppLockStore((s) => s.locked);
  const prompting = useRef(false);

  const prompt = async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      await tryUnlock();
    } finally {
      prompting.current = false;
    }
  };

  useEffect(() => {
    const subscribe = getPlatform().onAppStateChange;
    if (!subscribe) return;
    return subscribe((active) => {
      if (!active) useAppLockStore.getState().lock();
      else if (useAppLockStore.getState().locked) void prompt();
    });
  }, []);

  useEffect(() => {
    if (enabled && locked) void prompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, locked]);

  if (!enabled || !locked) return <>{children}</>;
  return (
    <div role="dialog" aria-modal="true" aria-label="Orbit is locked" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orbit-accent/10 text-orbit-accent">
        <LockIcon className="h-6 w-6" />
      </span>
      <h1 className="text-lg font-bold">Orbit is locked</h1>
      <Button variant="primary" onClick={() => void prompt()}>
        Unlock
      </Button>
    </div>
  );
}
