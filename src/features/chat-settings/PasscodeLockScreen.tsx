import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "../../ui";
import { LockIcon } from "../../ui/icons";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useConversationsStore, type Conversation } from "../conversations/conversationsStore";

/**
 * Shown instead of the timeline while a passcode chat is locked. Nothing is fetched or
 * decrypted for it until the server accepts the passcode.
 */
export function PasscodeLockScreen({ conversation, title }: { conversation: Conversation; title: string }) {
  const [mode, setMode] = useState<"passcode" | "recovery">("passcode");
  const [passcode, setPasscode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = () => useChatLockStore.getState().unlock(conversation.id, conversation.lockMode, conversation.lockTimeoutSeconds);

  const submitPasscode = async (event: FormEvent) => {
    event.preventDefault();
    const token = useAuthStore.getState().token;
    if (!token || passcode.length < conversation.passcodeLength) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifyPasscode(conversation.id, passcode, token);
      unlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That passcode isn't right.");
      setPasscode("");
    } finally {
      setBusy(false);
    }
  };

  const submitRecovery = async (event: FormEvent) => {
    event.preventDefault();
    const token = useAuthStore.getState().token;
    if (!token || !recoveryCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.bypassPasscode(conversation.id, recoveryCode.trim(), token);
      unlock();
      // The bypass turns the passcode off; reload so the chat reflects that.
      await useConversationsStore.getState().load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That recovery code didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] text-orbit-muted">
          <LockIcon className="h-6 w-6" />
        </span>
        <h2 className="mt-4 text-base font-bold">{title} is locked</h2>

        {error && (
          <Alert tone="danger" className="mt-4 text-left">
            {error}
          </Alert>
        )}

        {mode === "passcode" ? (
          <form onSubmit={submitPasscode} className="mt-4 space-y-3">
            <p className="text-sm text-orbit-muted">Enter the {conversation.passcodeLength}-digit passcode.</p>
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              aria-label="Chat passcode"
              value={passcode}
              maxLength={6}
              onChange={(event) => {
                setPasscode(event.target.value.replace(/\D/g, "").slice(0, 6));
                setError(null);
              }}
              placeholder={"•".repeat(conversation.passcodeLength)}
              className="h-12 text-center font-mono text-2xl tracking-[0.4em]"
            />
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || passcode.length < conversation.passcodeLength}>
              {busy ? "Checking…" : "Unlock"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setMode("recovery");
                setError(null);
              }}
              className="text-xs text-orbit-muted underline-offset-2 hover:text-orbit-text hover:underline"
            >
              Forgot it? Use a recovery code
            </button>
          </form>
        ) : (
          <form onSubmit={submitRecovery} className="mt-4 space-y-3 text-left">
            <Alert tone="warning">This turns off the passcode for this chat and uses up the recovery code.</Alert>
            <Field label="Recovery code">
              {(field) => (
                <Input
                  {...field}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                  className="font-mono tracking-wider"
                />
              )}
            </Field>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  setMode("passcode");
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button type="submit" variant="primary" className="flex-1" disabled={busy || !recoveryCode.trim()}>
                {busy ? "Unlocking…" : "Unlock with code"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
