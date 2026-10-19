import { useEffect, useState } from "react";
import { Button, IconButton, cn } from "../ui";
import { CloseIcon } from "../ui/icons";
import { installUpdateAction } from "./useDesktop";

const VISIBLE: UpdaterStatus[] = ["available", "downloading", "downloaded", "error"];

/** Slim bar under the title bar while an update downloads, is ready, or failed. */
export function UpdateBanner({ status, isMac }: { status: UpdaterStatusPayload | null; isMac: boolean }) {
  const [dismissed, setDismissed] = useState<UpdaterStatusPayload | null>(null);

  // A new status event brings the banner back after it was dismissed.
  useEffect(() => setDismissed(null), [status?.status]);

  if (!status || !VISIBLE.includes(status.status) || dismissed === status) return null;

  const isError = status.status === "error";
  const install = installUpdateAction(isMac);
  const fallback: Partial<Record<UpdaterStatus, string>> = {
    available: "A new version is available. Downloading…",
    downloading: "Downloading update…",
    downloaded: status.version ? `Version ${status.version} is ready.` : "An update is ready.",
    error: "Update failed."
  };

  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "flex shrink-0 items-center gap-3 border-b px-3 py-1.5 text-xs",
        isError ? "border-orbit-danger/30 bg-orbit-danger/10 text-rose-200" : "border-orbit-accent/25 bg-orbit-accent/10"
      )}
    >
      <span className="min-w-0 flex-1 truncate font-semibold">{status.message ?? fallback[status.status]}</span>
      {typeof status.progress === "number" && status.status !== "downloaded" && (
        <span className="h-1.5 w-40 overflow-hidden rounded-full bg-black/30" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-orbit-accent transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, status.progress))}%` }}
          />
        </span>
      )}
      {status.status === "downloaded" && (
        <Button size="sm" variant="primary" onClick={install.run}>
          {install.label}
        </Button>
      )}
      {(isError || status.status === "downloaded") && (
        <IconButton label="Dismiss" size="sm" onClick={() => setDismissed(status)}>
          <CloseIcon className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  );
}
