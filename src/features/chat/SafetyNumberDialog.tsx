import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Alert, Button, Dialog, DialogClose, DialogContent } from "../../ui";
import { safetyNumber } from "../../lib/deviceTrust";
import { ownIdentityPublicKey } from "../../lib/deviceIdentity";
import { useAuthStore } from "../../stores/authStore";
import { acceptNewIdentity, setContactVerified, useContactTrustStore } from "./contactTrust";

/**
 * Safety numbers (mobile plan B6): the two users' identity keys as 60 digits, the same on both
 * phones. Comparing them (read aloud, or by scanning the QR) proves nobody is in the middle.
 * When a contact's key changed, this is also where the user reviews and accepts the new one.
 */
export function SafetyNumberDialog({ userId, username, open, onOpenChange }: { userId: string; username: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const myUserId = useAuthStore((s) => s.user?.id);
  const trust = useContactTrustStore((s) => s.byUserId[userId]);
  const [digits, setDigits] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const theirKey = trust?.status === "ok" ? trust.identityKey : trust?.status === "identity-changed" ? trust.currentIdentityKey : null;

  useEffect(() => {
    let live = true;
    setDigits(null);
    setQr(null);
    if (!open || !myUserId || !theirKey) return;
    void (async () => {
      const mine = await ownIdentityPublicKey(myUserId);
      if (!mine) {
        if (live) setError("This device isn't linked, so it has no security key to compare.");
        return;
      }
      const number = await safetyNumber({ userId: myUserId, identityPublicKey: mine }, { userId, identityPublicKey: theirKey });
      if (!live) return;
      setDigits(number);
      setQr(await QRCode.toDataURL(`orbit-safety:${number.replace(/\s/g, "")}`, { margin: 1, width: 200 }));
    })();
    return () => {
      live = false;
    };
  }, [open, myUserId, userId, theirKey]);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const groups = digits?.split(" ") ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={trust?.status === "identity-changed" ? `@${username}'s security key changed` : `Verify @${username}`}
        description={
          trust?.status === "identity-changed"
            ? "This happens when they reset their account or set Orbit up again without their old devices. It can also mean someone else took over their account. Nothing is sent to them until you accept."
            : "Compare these numbers with the ones on their screen, in person or on a call you trust. If they match, nobody is listening in."
        }
        size="md"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">Close</Button>
            </DialogClose>
            {trust?.status === "identity-changed" && (
              <Button variant="primary" disabled={busy} onClick={() => void act(() => acceptNewIdentity(userId, trust.currentIdentityKey))}>
                Accept new key
              </Button>
            )}
            {trust?.status === "ok" &&
              (trust.verified ? (
                <Button disabled={busy} onClick={() => void act(() => setContactVerified(userId, trust.identityKey, false))}>
                  Clear verification
                </Button>
              ) : (
                <Button variant="primary" disabled={busy || !digits} onClick={() => void act(() => setContactVerified(userId, trust.identityKey, true))}>
                  Mark as verified
                </Button>
              ))}
          </>
        }
      >
        {trust?.status === "ok" && trust.verified && <Alert className="mb-3">You verified @{username}.</Alert>}
        {(!trust || trust.status === "no-identity" || trust.status === "error") && (
          <Alert tone="warning">@{username} hasn't set up a security key yet, so there's nothing to compare.</Alert>
        )}
        {digits && (
          <div className="flex flex-col items-center gap-4">
            <div className="grid grid-cols-4 gap-x-4 gap-y-1 font-mono text-lg tracking-wider" aria-label={`Safety number ${digits}`}>
              {groups.map((group, index) => (
                <span key={index}>{group}</span>
              ))}
            </div>
            {qr && <img src={qr} alt="Safety number QR code" width={200} height={200} className="rounded-xl bg-white p-2" />}
          </div>
        )}
        {error && (
          <Alert tone="danger" className="mt-3">
            {error}
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
