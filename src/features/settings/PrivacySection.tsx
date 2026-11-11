import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Dialog, DialogClose, DialogContent, Textarea, cn } from "../../ui";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { getPlatform } from "../../platform";
import { DevicesSection } from "./DevicesSection";
import { DeviceSecuritySection } from "./DeviceSecuritySection";

const recoveryStatusKey = ["recoveryCodeStatus"] as const;

/** Codes typed or pasted one per line (or comma-separated). */
export function parseCodes(input: string) {
  return input
    .split(/[\n,]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

export function PrivacySection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-bold">Privacy and security</h1>
      </header>
      <DevicesSection />
      <DeviceSecuritySection />
      <UnfriendSetting />
      <RecoveryCodes />
    </div>
  );
}

function UnfriendSetting() {
  const me = useAuthStore((s) => s.user)!;
  const value = useProfilesStore((s) => s.byId[me.id]?.deleteMessagesOnUnfriend ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    setBusy(true);
    setError(null);
    const updated = await useProfilesStore.getState().updateMyProfile({ deleteMessagesOnUnfriend: !value }, token, me.id);
    if (!updated) setError(useProfilesStore.getState().errorById[me.id] ?? "Couldn't save.");
    setBusy(false);
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-orbit-panel/60 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Delete my messages when I unfriend someone</h2>
          <p className="mt-1 text-[11px] text-orbit-muted">Your messages and files in that direct chat are permanently removed for both of you.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Delete my messages when I unfriend someone"
          disabled={busy}
          onClick={toggle}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60 disabled:opacity-50",
            value ? "bg-orbit-accent" : "bg-white/15"
          )}
        >
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", value ? "translate-x-4" : "translate-x-0.5")} />
        </button>
      </div>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </section>
  );
}

/**
 * Recovery codes sign you in without a password and unlock forgotten chat passcodes.
 * Getting new ones, or turning them off for good, both need current codes as proof.
 */
function RecoveryCodes() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: recoveryStatusKey,
    queryFn: () => api.getRecoveryCodeStatus(useAuthStore.getState().token!)
  });
  const [mode, setMode] = useState<"refresh" | "disable" | null>(null);
  const [codes, setCodes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const close = () => {
    setMode(null);
    setCodes("");
    setError(null);
  };

  const run = async () => {
    const token = useAuthStore.getState().token;
    const list = parseCodes(codes);
    if (!token || !list.length || !mode) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "refresh") {
        const result = await api.refreshRecoveryCodes(list, token);
        setNewCodes(result.recoveryCodes);
      } else {
        await api.disableRecoveryCodes(list, token);
      }
      close();
      void queryClient.invalidateQueries({ queryKey: recoveryStatusKey });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-orbit-panel/60 p-5">
      <h2 className="text-sm font-semibold">Recovery codes</h2>
      <p className="mt-1 text-[11px] text-orbit-muted">Sign in without your password, or unlock a chat whose passcode you forgot. Each code works once.</p>

      {status.isLoading && <p className="mt-3 text-sm text-orbit-muted">Loading…</p>}
      {status.isError && (
        <Alert tone="danger" className="mt-3">
          Couldn't load recovery code status.
        </Alert>
      )}
      {status.data && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {status.data.active ? (
            <>
              <Badge tone="accent">Active</Badge>
              <span className="text-sm">
                {status.data.remaining} of {status.data.total} left
              </span>
            </>
          ) : (
            <Badge tone="danger">Turned off permanently</Badge>
          )}
        </div>
      )}
      {status.data?.active && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("refresh")}>
            Get new codes…
          </Button>
          <Button size="sm" variant="ghost" className="text-orbit-danger" onClick={() => setMode("disable")}>
            Turn off recovery codes…
          </Button>
        </div>
      )}

      {newCodes && (
        <div className="mt-4 rounded-xl border border-orbit-warning/30 bg-orbit-warning/5 p-4">
          <p className="text-sm font-semibold">Your new recovery codes</p>
          <p className="mt-0.5 text-[11px] text-orbit-muted">Save them now. Your old codes no longer work, and these won't be shown again.</p>
          <ol className="mt-3 grid grid-cols-2 gap-2" aria-label="New recovery codes">
            {newCodes.map((code) => (
              <li key={code} className="select-all rounded-lg border border-white/10 bg-orbit-panel px-3 py-1.5 text-center font-mono text-sm">
                {code}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void getPlatform().clipboard.writeText(newCodes.join("\n")).catch(() => {})}>
              Copy all
            </Button>
            <Button size="sm" variant="primary" onClick={() => setNewCodes(null)}>
              I've saved them
            </Button>
          </div>
        </div>
      )}

      <Dialog open={mode !== null} onOpenChange={(open) => !open && close()}>
        {mode && (
          <DialogContent
            title={mode === "refresh" ? "Get new recovery codes" : "Turn off recovery codes?"}
            description={
              mode === "refresh"
                ? "Enter one or more of your current codes. You'll get a fresh set and the old ones stop working."
                : "Enter one or more of your current codes. Without recovery codes, a forgotten password or chat passcode can't be recovered. This can't be undone."
            }
            dismissible={!busy}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={busy}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button variant={mode === "refresh" ? "primary" : "danger"} disabled={busy || !parseCodes(codes).length} onClick={run}>
                  {busy ? "Working…" : mode === "refresh" ? "Get new codes" : "Turn off permanently"}
                </Button>
              </>
            }
          >
            <Textarea
              aria-label="Current recovery codes"
              value={codes}
              onChange={(e) => setCodes(e.target.value)}
              placeholder={"xxxx-xxxx-xxxx-xxxx\nxxxx-xxxx-xxxx-xxxx"}
              spellCheck={false}
              className="font-mono"
            />
            {error && (
              <Alert tone="danger" className="mt-3">
                {error}
              </Alert>
            )}
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
