import { useState } from "react";
import { Alert, Button, Dialog, DialogContent } from "../../ui";
import { CopyIcon } from "../../ui/icons";
import { usePasscodeRevealStore } from "./passcodeRevealStore";
import { getPlatform } from "../../platform";

/**
 * A chat's passcode, shown exactly once (new passcode chat, re-enabled protection, or
 * the first time you open a chat someone else secured). It can't be dismissed by
 * accident: only "I've saved it" closes it.
 */
export function PasscodeRevealDialog() {
  const current = usePasscodeRevealStore((s) => s.current);
  const dismiss = usePasscodeRevealStore((s) => s.dismiss);
  const [copied, setCopied] = useState(false);

  return (
    <Dialog open={Boolean(current)} onOpenChange={() => {}}>
      {current && (
        <DialogContent
          title="Save this chat's passcode"
          description={`${current.label} is protected with a passcode. You'll need it every time the chat locks.`}
          size="sm"
          dismissible={false}
          footer={
            <Button
              variant="primary"
              onClick={() => {
                setCopied(false);
                dismiss();
              }}
            >
              I've saved it
            </Button>
          }
        >
          <div className="flex items-center justify-center rounded-xl border border-white/10 bg-orbit-panelAlt py-6">
            <span className="select-all font-mono text-4xl font-bold tracking-[0.35em] text-orbit-accent" aria-label={`Passcode ${current.passcode.split("").join(" ")}`}>
              {current.passcode}
            </span>
          </div>
          <Button
            className="mt-3 w-full"
            onClick={async () => {
              try {
                await getPlatform().clipboard.writeText(current.passcode);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <CopyIcon className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy passcode"}
          </Button>
          <Alert tone="warning" className="mt-3 text-xs">
            You won't see it again. If you forget it, an account recovery code can unlock the chat.
          </Alert>
        </DialogContent>
      )}
    </Dialog>
  );
}
