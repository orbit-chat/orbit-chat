import { useState } from "react";
import { Alert, Button } from "../../ui";
import { CopyIcon, LockIcon } from "../../ui/icons";
import { useAuthStore } from "../../stores/authStore";
import { getPlatform } from "../../platform";

/** Shown once, right after signup. The codes are never retrievable again. */
export function RecoveryCodesScreen({ codes }: { codes: string[] }) {
  const clearPendingRecoveryCodes = useAuthStore((s) => s.clearPendingRecoveryCodes);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const copy = async () => {
    try {
      await getPlatform().clipboard.writeText(codes.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([`Orbit Chat recovery codes\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    void getPlatform().saveFile("orbit-recovery-codes.txt", blob).catch(() => {});
  };

  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-6 sm:items-center">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-orbit-panel p-8 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orbit-accent/15 text-orbit-accent">
            <LockIcon />
          </span>
          <h1 className="text-xl font-bold">Save your recovery codes</h1>
        </div>
        <p className="mt-3 text-sm text-orbit-muted">
          If you forget your password, each code signs you in once. They also unlock chat passcodes you've forgotten.
        </p>
        <Alert tone="warning" className="mt-4">
          You won't see these codes again after leaving this screen.
        </Alert>

        <ol className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-3" aria-label="Recovery codes">
          {codes.map((code) => (
            <li
              key={code}
              className="select-all rounded-lg border border-white/10 bg-orbit-panel px-3 py-2 text-center font-mono text-sm tracking-wider"
            >
              {code}
            </li>
          ))}
        </ol>

        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={copy}>
            <CopyIcon className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy all"}
          </Button>
          <Button className="flex-1" onClick={download}>
            Save as .txt
          </Button>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[rgb(var(--orbit-accent))]"
          />
          I've stored these codes somewhere safe.
        </label>

        <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!confirmed} onClick={clearPendingRecoveryCodes}>
          Continue to Orbit
        </Button>
      </section>
    </div>
  );
}
