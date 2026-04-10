/**
 * Orbit Dev Logger
 *
 * In-app error/log overlay for Electron builds where devTools are disabled.
 * - Captures uncaught errors, unhandled promise rejections, and console.error
 * - Shows a small error badge in the corner; click to expand the full log
 * - Toggle full log panel with Ctrl+Shift+F12
 * - Only active when import.meta.env.DEV is true (Vite dev mode)
 */

type LogEntry = {
  timestamp: number;
  level: "error" | "warn" | "info";
  message: string;
  stack?: string;
};

const MAX_ENTRIES = 200;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

function addEntry(level: LogEntry["level"], message: string, stack?: string) {
  entries.push({ timestamp: Date.now(), level, message, stack });
  if (entries.length > MAX_ENTRIES) entries.shift();
  listeners.forEach((fn) => fn());
}

/** Subscribe to log changes. Returns an unsubscribe function. */
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Get a snapshot of all log entries. */
export function getEntries(): readonly LogEntry[] {
  return entries;
}

/** Format a log entry for display. */
export function formatEntry(e: LogEntry): string {
  const time = new Date(e.timestamp).toLocaleTimeString();
  const tag = e.level.toUpperCase().padEnd(5);
  return `[${time}] ${tag} ${e.message}${e.stack ? "\n" + e.stack : ""}`;
}

/** Programmatic log functions. */
export const devLog = {
  info: (msg: string) => addEntry("info", msg),
  warn: (msg: string) => addEntry("warn", msg),
  error: (msg: string, stack?: string) => addEntry("error", msg, stack),
};

/**
 * Install global error handlers. Call once at app startup.
 * Safe to call in production — it no-ops when not in dev mode.
 */
export function installDevLogger() {
  if (!import.meta.env.DEV) return;

  // Capture uncaught errors
  window.addEventListener("error", (e) => {
    addEntry("error", e.message || String(e.error), e.error?.stack);
  });

  // Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    addEntry("error", `Unhandled rejection: ${msg}`, stack);
  });

  // Intercept console.error and console.warn
  const origError = console.error;
  const origWarn = console.warn;

  console.error = (...args: unknown[]) => {
    origError.apply(console, args);
    const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
    const stack = args.find((a) => a instanceof Error) as Error | undefined;
    addEntry("error", msg, stack?.stack);
  };

  console.warn = (...args: unknown[]) => {
    origWarn.apply(console, args);
    const msg = args.map((a) => String(a)).join(" ");
    addEntry("warn", msg);
  };

  addEntry("info", "Dev logger installed");
}
