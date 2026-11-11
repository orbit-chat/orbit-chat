import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Dialog, DialogClose, DialogContent } from "../../ui";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useE2EEStore } from "../../stores/e2eeStore";
import type { DeviceIdentityStatus } from "../../lib/deviceIdentity";
import { LinkDeviceDialog } from "../devices/LinkDeviceDialog";
import { ResetIdentityDialog } from "../devices/ResetIdentityDialog";
import { removeLinkedDevice, signOutUnlinkedDevice } from "../devices/revokeDevice";
import { signOut } from "../auth/signOut";

export const devicesQueryKey = ["accountDevices"] as const;

/** The server keeps no activity times (no-logs policy), so a device shows only its state. */
function deviceState(device: { current: boolean; signedIn: boolean }) {
  if (device.current) return "This device";
  return device.signedIn ? "Signed in" : "Signed out";
}

/** What this device's own identity status means for the user (mobile plan B6/B7/B10). */
export function thisDeviceNotice(status: DeviceIdentityStatus | undefined) {
  if (status === "pending") {
    return {
      tone: "warning" as const,
      text: "This device isn't linked to your account yet, so it can't read your chats. Link it from one of your other devices."
    };
  }
  if (status === "conflict") {
    return {
      tone: "danger" as const,
      text: "This device holds a different security identity from the one your account uses. If you didn't set up Orbit on another device yourself, someone else may have signed in with your password or a recovery code. Change your password, and don't share anything sensitive until this is resolved."
    };
  }
  return null;
}

type PendingAction = { kind: "remove" | "forget" | "sign-out"; device: api.AccountDevice };

const actionCopy = {
  remove: {
    title: "Remove this device?",
    body: "It will be signed out and lose access to your chats. Every chat gets a new key, so it can't read anything sent from now on.",
    confirm: "Remove device"
  },
  forget: {
    title: "Sign out and forget this device?",
    body: "This device's keys are erased. To use Orbit here again, sign in and link it from another device.",
    confirm: "Forget this device"
  },
  "sign-out": {
    title: "Sign out this device?",
    body: "It isn't linked, so it can't read your chats. Signing it out ends its session. If you don't recognize it, also change your password.",
    confirm: "Sign out"
  }
} as const;

function statusLabel(status: api.LinkSessionStatus) {
  return { open: "Waiting", joined: "In progress", completed: "Linked", failed: "Failed", cancelled: "Replaced", expired: "Expired" }[status];
}

/**
 * Settings → Privacy → Devices: link a device (B7), remove one (B8), sign out an unlinked one.
 * A device the user doesn't recognize, especially an unlinked one, is the visible sign that
 * someone else has their password or a recovery code; so is a linking attempt they didn't make.
 */
export function DevicesSection() {
  const myUserId = useAuthStore((s) => s.user?.id);
  const token = useAuthStore((s) => s.token);
  const status = useE2EEStore((s) => (myUserId ? s.deviceIdentityStatusByUserId[myUserId] : undefined));
  const perDevice = useE2EEStore((s) => (myUserId ? s.perDeviceKeysByUserId[myUserId] === true : false));
  const queryClient = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const devices = useQuery({
    // Per user (a cached list must never show another account's devices) and per identity status,
    // so the list refreshes once this device finishes setting up.
    queryKey: [...devicesQueryKey, myUserId, status],
    queryFn: () => api.getMyDevices(token!),
    enabled: Boolean(myUserId && token)
  });
  const attempts = useQuery({
    queryKey: [...devicesQueryKey, "linkAttempts", myUserId],
    queryFn: () => api.getRecentLinkSessions(token!),
    enabled: Boolean(myUserId && token && perDevice)
  });
  const notice = thisDeviceNotice(status);
  const trustedCount = devices.data?.devices.filter((d) => d.trusted).length ?? 0;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: devicesQueryKey });

  const runAction = async () => {
    if (!pending || !myUserId) return;
    const currentToken = useAuthStore.getState().token;
    if (!currentToken) return;
    setBusy(true);
    setActionError(null);
    try {
      if (pending.kind === "sign-out") {
        await signOutUnlinkedDevice({ token: currentToken, deviceId: pending.device.id });
      } else {
        const result = await removeLinkedDevice({ userId: myUserId, token: currentToken, deviceId: pending.device.id });
        if (result.forgotThisDevice) {
          setPending(null);
          signOut(queryClient);
          return;
        }
      }
      setPending(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  // Before the account has an identity nothing is linked yet, so there is nothing to warn about.
  const pendingOthers = devices.data?.identityPublished
    ? devices.data.devices.filter((d) => !d.trusted && !d.current && d.signedIn)
    : [];

  return (
    <section className="rounded-2xl border border-white/10 bg-orbit-panel/60 p-5" aria-labelledby="devices-heading">
      <h2 id="devices-heading" className="text-sm font-semibold">
        Devices
      </h2>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-orbit-muted">Devices signed in to your account. Only linked devices can read your chats.</p>
        {perDevice && (status === "trusted" || status === "pending") && (
          <Button size="sm" variant={status === "pending" ? "primary" : "secondary"} onClick={() => setLinkOpen(true)}>
            {status === "pending" ? "Link this device" : "Link a device"}
          </Button>
        )}
      </div>

      {notice && (
        <Alert tone={notice.tone} className="mt-3">
          {notice.text}
          {perDevice && (
            <span className="mt-2 block">
              <button type="button" className="text-[12px] font-semibold underline" onClick={() => setResetOpen(true)}>
                Lost all your other devices? Reset your security key
              </button>
            </span>
          )}
        </Alert>
      )}
      {pendingOthers.length > 0 && status !== "pending" && (
        <Alert tone="warning" className="mt-3">
          {pendingOthers.length === 1 ? "A device" : `${pendingOthers.length} devices`} signed in to your account but{" "}
          {pendingOthers.length === 1 ? "isn't" : "aren't"} linked. If you don't recognize{" "}
          {pendingOthers.length === 1 ? "it" : "them"}, change your password.
        </Alert>
      )}

      {devices.isLoading && <p className="mt-3 text-sm text-orbit-muted">Loading…</p>}
      {devices.isError && (
        <Alert tone="danger" className="mt-3">
          <span className="flex flex-wrap items-center justify-between gap-2">
            Couldn't load your devices.
            <Button size="sm" onClick={() => void devices.refetch()}>
              Try again
            </Button>
          </span>
        </Alert>
      )}

      {devices.data && (
        <ul className="mt-3 divide-y divide-white/5 rounded-xl border border-white/10" aria-label="Your devices">
          {devices.data.devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {device.name}
                  {device.current && <span className="ml-1.5 text-[11px] font-normal text-orbit-muted">(this device)</span>}
                </p>
                <p className="text-[11px] text-orbit-muted">{deviceState(device)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {!devices.data.identityPublished ? (
                  <Badge>Setting up</Badge>
                ) : device.trusted ? (
                  <Badge tone="accent">Linked</Badge>
                ) : (
                  <Badge tone="warning">Not linked</Badge>
                )}
                {perDevice && status === "trusted" && device.trusted && !device.current && (
                  <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "remove", device })}>
                    Remove
                  </Button>
                )}
                {perDevice && status === "trusted" && device.trusted && device.current && trustedCount > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "forget", device })}>
                    Forget
                  </Button>
                )}
                {status === "trusted" && !device.trusted && device.signedIn && !device.current && (
                  <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "sign-out", device })}>
                    Sign out
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {attempts.data && attempts.data.length > 0 && (
        <details className="mt-3 text-[11px] text-orbit-muted">
          <summary className="cursor-pointer select-none">Linking attempts in the last 7 days ({attempts.data.length})</summary>
          <ul className="mt-2 space-y-1" aria-label="Recent linking attempts">
            {attempts.data.map((attempt) => (
              <li key={attempt.sessionId} className="flex flex-wrap justify-between gap-2">
                <span>
                  {new Date(attempt.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                  {attempt.creatorDeviceName ?? "Unknown device"}
                  {attempt.joinerDeviceName ? ` → ${attempt.joinerDeviceName}` : ""}
                </span>
                <span>{statusLabel(attempt.status)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {(status === "trusted" || status === "pending") && (
        <LinkDeviceDialog
          side={status === "pending" ? "new" : "trusted"}
          open={linkOpen}
          onOpenChange={setLinkOpen}
          onLinked={refresh}
        />
      )}

      <ResetIdentityDialog open={resetOpen} onOpenChange={setResetOpen} onReset={refresh} />

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        {pending && (
          <DialogContent
            title={actionCopy[pending.kind].title}
            description={pending.device.name}
            size="sm"
            dismissible={!busy}
            footer={
              <>
                <DialogClose asChild>
                  <Button variant="ghost" disabled={busy}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button variant="danger" onClick={() => void runAction()} disabled={busy}>
                  {busy ? "Working…" : actionCopy[pending.kind].confirm}
                </Button>
              </>
            }
          >
            <p className="text-sm">{actionCopy[pending.kind].body}</p>
            {actionError && (
              <Alert tone="danger" className="mt-3">
                {actionError}
              </Alert>
            )}
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
