import { useState } from "react";
import { Button } from "../ui";
import { useAuthStore } from "../stores/authStore";
import { useE2EEStore } from "../stores/e2eeStore";
import { LinkDeviceDialog } from "../features/devices/LinkDeviceDialog";

/**
 * Shown on a device that signed in but isn't linked yet (mobile plan B7): with per-device keys it
 * can't read or send anything until it is, so the way to fix that sits at the top of every screen.
 */
export function PendingDeviceBanner() {
  const userId = useAuthStore((s) => s.user?.id);
  const pending = useE2EEStore((s) => (userId ? s.deviceIdentityStatusByUserId[userId] === "pending" && s.perDeviceKeysByUserId[userId] === true : false));
  const [open, setOpen] = useState(false);
  if (!pending) return null;
  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-orbit-warning/30 bg-orbit-warning/10 px-4 py-2 text-sm text-amber-100">
      <span>This device isn't linked yet, so it can't read or send messages.</span>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Link this device
      </Button>
      <LinkDeviceDialog side="new" open={open} onOpenChange={setOpen} />
    </div>
  );
}
