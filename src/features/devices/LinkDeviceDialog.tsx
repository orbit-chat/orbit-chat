import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Alert, Button, Dialog, DialogContent, Field, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui";
import { getPlatform } from "../../platform";
import { useAuthStore } from "../../stores/authStore";
import { normalizeLinkCode } from "../../lib/deviceLinking";
import {
  joinLinkingFromNew,
  joinLinkingFromTrusted,
  startLinkingFromNew,
  startLinkingFromTrusted,
  type LinkController,
  type LinkUpdate,
} from "./linkDevice";

/**
 * Linking a device (mobile plan B7). On a linked device it links a new one; on an unlinked device
 * it gets this one linked. Either side can show the code (QR or typed) and the other scans or
 * types it; the user always confirms on the linked device after comparing the 6-digit codes.
 */

type Side = "trusted" | "new";
type Method = "show-qr" | "show-code" | "enter-code" | "scan";

function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width: 240 }).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [text]);
  return src ? (
    <img src={src} alt="Linking QR code" width={240} height={240} className="mx-auto rounded-xl bg-white p-2" />
  ) : (
    <div className="mx-auto h-[240px] w-[240px] animate-pulse rounded-xl bg-white/10" aria-label="Preparing QR code" />
  );
}

function ConfirmationCode({ code }: { code: string }) {
  return (
    <p className="text-center font-mono text-3xl font-bold tracking-[0.3em]" aria-label={`Confirmation code ${code.split("").join(" ")}`}>
      {code.slice(0, 3)} {code.slice(3)}
    </p>
  );
}

function Progress({ update, onConfirm, onCancel, onRetry }: { update: LinkUpdate; onConfirm: () => void; onCancel: () => void; onRetry: () => void }) {
  const countdown = useCountdown("expiresAt" in update ? update.expiresAt : undefined);
  switch (update.step) {
    case "starting":
      return <p className="text-center text-sm text-orbit-muted">Starting…</p>;
    case "show-qr":
      return (
        <div className="space-y-3 text-center">
          <QrImage text={update.qr} />
          <p className="text-sm">Scan this with the other device.</p>
          {countdown && <p className="text-[11px] text-orbit-muted">Expires in {countdown}</p>}
        </div>
      );
    case "show-code":
      return (
        <div className="space-y-3 text-center">
          <p className="font-mono text-3xl font-bold tracking-[0.2em]" data-testid="link-code">
            {update.code}
          </p>
          <p className="text-sm">Type this code on the other device.</p>
          {countdown && <p className="text-[11px] text-orbit-muted">Expires in {countdown}</p>}
        </div>
      );
    case "waiting":
      return <p className="text-center text-sm text-orbit-muted">Waiting for the other device…</p>;
    case "confirm":
      return (
        <div className="space-y-4">
          <p className="text-sm">
            Link <strong>{update.deviceName}</strong> to your account? It will be able to read all your chats.
          </p>
          <ConfirmationCode code={update.code} />
          <p className="text-[11px] text-orbit-muted">Only continue if the other device shows exactly this code.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirm}>
              Link device
            </Button>
          </div>
        </div>
      );
    case "confirm-elsewhere":
      return (
        <div className="space-y-4 text-center">
          <ConfirmationCode code={update.code} />
          <p className="text-sm">Check that your other device shows the same code, then confirm there.</p>
        </div>
      );
    case "finishing":
      return <p className="text-center text-sm text-orbit-muted">Finishing…</p>;
    case "done":
      return (
        <Alert tone="info">
          {update.deviceName ? `${update.deviceName} is linked.` : "This device is linked. Your chats will appear in a moment."}
        </Alert>
      );
    case "failed":
      return (
        <div className="space-y-3">
          <Alert tone="danger">{update.message}</Alert>
          <div className="flex justify-end">
            <Button onClick={onRetry}>Try again</Button>
          </div>
        </div>
      );
  }
}

export function LinkDeviceDialog({ side, open, onOpenChange, onLinked }: { side: Side; open: boolean; onOpenChange: (open: boolean) => void; onLinked?: () => void }) {
  const userId = useAuthStore((s) => s.user?.id);
  const canScan = Boolean(getPlatform().scanQrCode);
  const [method, setMethod] = useState<Method>(side === "trusted" ? "show-qr" : canScan ? "scan" : "enter-code");
  const [update, setUpdate] = useState<LinkUpdate | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const controller = useRef<LinkController | null>(null);
  const methodRef = useRef(method);

  const session = () => ({ userId: userId!, token: () => useAuthStore.getState().token });

  /** Start a flow; only the newest one may update the dialog (a cancelled one still reports "cancelled"). */
  const run = (start: (onUpdate: (update: LinkUpdate) => void) => LinkController) => {
    controller.current?.cancel();
    setUpdate({ step: "starting" });
    let current: LinkController | null = null;
    const onUpdate = (next: LinkUpdate) => {
      if (current === null || controller.current === current) setUpdate(next);
    };
    current = start(onUpdate);
    controller.current = current;
    void current.done.then((linked) => {
      if (linked && controller.current === current) onLinked?.();
    });
  };

  const begin = (next: Method) => {
    if (!userId) return;
    if (next === "show-qr" || next === "show-code") {
      const mode = next === "show-qr" ? "qr" : "code";
      run((onUpdate) => (side === "trusted" ? startLinkingFromTrusted(session(), mode, onUpdate) : startLinkingFromNew(session(), mode, onUpdate)));
    } else {
      controller.current?.cancel();
      controller.current = null;
      setUpdate(null);
    }
  };


  // Start the default method when the dialog opens; stop whatever is running when it closes.
  useEffect(() => {
    if (open) begin(method);
    else {
      controller.current?.cancel();
      controller.current = null;
      setUpdate(null);
      setCode("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => controller.current?.cancel(), []);

  const submitCode = () => {
    const normalized = normalizeLinkCode(code);
    if (!normalized) {
      setCodeError("Codes are 8 letters and numbers, like K7QM-2XRP.");
      return;
    }
    setCodeError(null);
    run((onUpdate) => (side === "trusted" ? joinLinkingFromTrusted(session(), { code: normalized }, onUpdate) : joinLinkingFromNew(session(), { code: normalized }, onUpdate)));
  };

  const scan = async () => {
    const text = await getPlatform().scanQrCode?.();
    if (!text) return;
    run((onUpdate) => (side === "trusted" ? joinLinkingFromTrusted(session(), { qr: text }, onUpdate) : joinLinkingFromNew(session(), { qr: text }, onUpdate)));
  };

  const progress = update && (
    <Progress
      update={update}
      onConfirm={() => controller.current?.confirm()}
      onCancel={() => controller.current?.cancel()}
      onRetry={() => begin(method)}
    />
  );
  const busy = update !== null && update.step !== "failed" && update.step !== "done";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={side === "trusted" ? "Link a device" : "Link this device"}
        description={
          side === "trusted"
            ? "Sign in on the new device first, then link it here. Linking gives it access to all your chats."
            : "Use one of your linked devices to give this one access to your chats."
        }
        size="md"
      >
        <Tabs
          value={method}
          onValueChange={(value) => {
            // Radix can report one click twice (mouse down, then focus); starting twice would
            // create two sessions, and the second cancels the first on the server.
            if (value === methodRef.current) return;
            methodRef.current = value as Method;
            setMethod(value as Method);
            begin(value as Method);
          }}
        >
          <TabsList aria-label="How to link">
            <TabsTrigger value="show-qr">Show QR</TabsTrigger>
            <TabsTrigger value="show-code">Show code</TabsTrigger>
            <TabsTrigger value="enter-code">Enter code</TabsTrigger>
            {canScan && <TabsTrigger value="scan">Scan</TabsTrigger>}
          </TabsList>
          <TabsContent value="show-qr" className="mt-4">
            {progress}
          </TabsContent>
          <TabsContent value="show-code" className="mt-4">
            {progress}
          </TabsContent>
          <TabsContent value="enter-code" className="mt-4 space-y-3">
            {update ? (
              progress
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCode();
                }}
              >
                <Field label="Code from the other device" error={codeError ?? undefined}>
                  {(props) => (
                    <Input
                      {...props}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="K7QM-2XRP"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      className="font-mono tracking-widest"
                    />
                  )}
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" disabled={!code.trim() || busy}>
                    Link
                  </Button>
                </div>
              </form>
            )}
          </TabsContent>
          {canScan && (
            <TabsContent value="scan" className="mt-4 space-y-3">
              {update ? (
                progress
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-orbit-muted">Point the camera at the QR code on the other device.</p>
                  <Button variant="primary" onClick={() => void scan()}>
                    Open camera
                  </Button>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
