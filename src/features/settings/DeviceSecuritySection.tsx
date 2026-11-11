import { useEffect, useState } from "react";
import { Alert, Button } from "../../ui";
import { getPlatform } from "../../platform";
import { enableAppLock, useAppLockStore } from "../security/appLock";

/**
 * Settings → Privacy → This phone (mobile plan M5): the app lock, and an advisory warning on a
 * rooted or jailbroken device. Only shown where the shell provides them (the phone apps).
 */
export function DeviceSecuritySection() {
  const platform = getPlatform();
  const enabled = useAppLockStore((s) => s.enabled);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [integrity, setIntegrity] = useState<{ compromised: boolean; reasons: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void platform.biometric?.available().then(setAvailable).catch(() => setAvailable(false));
    void platform.deviceIntegrity?.().then(setIntegrity).catch(() => setIntegrity(null));
  }, [platform]);

  if (!platform.biometric && !platform.deviceIntegrity) return null;

  const toggle = async () => {
    setError(null);
    if (enabled) {
      useAppLockStore.getState().setEnabled(false);
      return;
    }
    if (!(await enableAppLock())) setError("The app lock wasn't turned on. Make sure Face ID, Touch ID or a fingerprint is set up.");
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-orbit-panel/60 p-5" aria-labelledby="device-security-heading">
      <h2 id="device-security-heading" className="text-sm font-semibold">
        This phone
      </h2>
      {integrity?.compromised && (
        // Advisory only (M5): rooted/jailbroken devices aren't blocked.
        <Alert tone="warning" className="mt-3">
          This phone looks rooted or jailbroken. Other apps on it may be able to read Orbit's keys and messages.
        </Alert>
      )}
      {platform.biometric && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm">Lock Orbit with Face ID or fingerprint</p>
            <p className="mt-0.5 text-[11px] text-orbit-muted">
              {available === false ? "Set up Face ID, Touch ID or a fingerprint on this phone first." : "Asks every time Orbit is opened or comes back from the background."}
            </p>
          </div>
          <Button size="sm" variant={enabled ? "secondary" : "primary"} disabled={!enabled && available === false} onClick={() => void toggle()}>
            {enabled ? "Turn off" : "Turn on"}
          </Button>
        </div>
      )}
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </section>
  );
}
