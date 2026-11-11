import { useState } from "react";
import { Alert, Button, Dialog, DialogClose, DialogContent, Field, Input } from "../../ui";
import { resetOwnIdentity } from "../../lib/deviceIdentity";
import { deviceIdFromToken } from "../../lib/jwt";
import { getPlatform } from "../../platform";
import { useAuthStore } from "../../stores/authStore";
import { useE2EEStore } from "../../stores/e2eeStore";

/**
 * Reset security key (mobile plan B10): for someone who lost every linked device, so nothing can
 * link this one. Their old messages are gone for good, every contact is warned, and their other
 * devices are signed out. Needs the password and a recovery code.
 */
export function ResetIdentityDialog({ open, onOpenChange, onReset }: { open: boolean; onOpenChange: (open: boolean) => void; onReset?: () => void }) {
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const { token, user } = useAuthStore.getState();
    if (!token || !user) return;
    const deviceId = deviceIdFromToken(token);
    if (!deviceId) {
      setError("This session has no device ID. Sign in again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const e2ee = useE2EEStore.getState();
      const { publicKey } = await e2ee.ensureDeviceKeypair(user.id, token);
      await resetOwnIdentity(
        { userId: user.id, deviceId, deviceName: getPlatform().deviceName, encryptionPublicKey: publicKey, token },
        { password, recoveryCode }
      );
      e2ee.reset();
      await useE2EEStore.getState().ensureDeviceIdentity(user.id, token, { force: true });
      setPassword("");
      setRecoveryCode("");
      onOpenChange(false);
      onReset?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The reset didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        title="Reset your security key"
        description="Only if you've lost every device that was linked to your account."
        size="md"
        dismissible={!busy}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="danger" disabled={busy || !understood || !password || !recoveryCode.trim()} onClick={() => void submit()}>
              {busy ? "Resetting…" : "Reset security key"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Alert tone="warning">
            Your old messages can't be recovered on any device. Everyone you chat with is told your security key changed, and
            your other devices are signed out.
          </Alert>
          <Field label="Password">
            {(props) => <Input {...props} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Field label="Recovery code" hint="One of the codes you saved when you created your account. It's used up.">
            {(props) => <Input {...props} autoComplete="off" spellCheck={false} value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} className="font-mono" />}
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-1" />
            <span>I understand my message history will be lost.</span>
          </label>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
