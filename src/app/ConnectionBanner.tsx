import { useEffect, useState } from "react";
import { Button } from "../ui";
import { useAuthStore } from "../stores/authStore";
import { useSocketStore } from "../stores/socketStore";

/** How long a non-connected state must last before the banner appears, so normal startup doesn't flash it. */
const GRACE_MS = 2500;

/**
 * Replaces the old always-on "Realtime connected" badge: nothing is shown while
 * things work, and a clear bar with a retry appears when they don't.
 */
export function ConnectionBanner() {
  const state = useSocketStore((s) => s.connectionState);
  const error = useSocketStore((s) => s.connectionError);
  const connect = useSocketStore((s) => s.connect);
  const token = useAuthStore((s) => s.token);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state === "connected" || state === "idle") {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!visible) return null;

  const connecting = state === "connecting";
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-orbit-warning/25 bg-orbit-warning/10 px-3 py-1.5 text-xs text-amber-100"
    >
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-orbit-warning" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {connecting ? "Connecting to Orbit…" : "You're offline. New messages won't arrive until the connection is back."}
        {error && !connecting && <span className="ml-1 text-amber-200/70">({error})</span>}
      </span>
      {!connecting && token && (
        <Button size="sm" onClick={() => connect(token)}>
          Retry
        </Button>
      )}
    </div>
  );
}
