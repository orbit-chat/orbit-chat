import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribe, getEntries, formatEntry } from "../lib/devLogger";

/**
 * DevOverlay — In-app log viewer for dev builds.
 *
 * Shows a small error count badge in the bottom-right corner.
 * Click the badge or press Ctrl+Shift+F12 to toggle the full log panel.
 * Only renders when import.meta.env.DEV is true.
 */
export default function DevOverlay() {
  const [open, setOpen] = useState(false);

  const entries = useSyncExternalStore(
    subscribe,
    getEntries,
    getEntries,
  );

  // Keyboard shortcut: Ctrl+Shift+F12
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "F12") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const errorCount = entries.filter((e) => e.level === "error").length;
  const warnCount = entries.filter((e) => e.level === "warn").length;

  if (!open && errorCount === 0 && warnCount === 0) return null;

  return (
    <>
      {/* Badge */}
      {!open && (errorCount > 0 || warnCount > 0) && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-3 right-3 z-[99999] flex items-center gap-1.5 rounded-full border border-white/10 bg-[#1a1e2e] px-3 py-1.5 font-mono text-xs shadow-lg transition hover:bg-[#252a3a]"
        >
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-rose-400">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0V5zm.75 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z"/></svg>
              {errorCount}
            </span>
          )}
          {warnCount > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0V5zm.75 6.5a.75.75 0 100-1.5.75.75 0 000 1.5z"/></svg>
              {warnCount}
            </span>
          )}
        </button>
      )}

      {/* Full log panel */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-[99999] flex max-h-[40vh] flex-col border-t border-white/10 bg-[#0d1117]/95 backdrop-blur">
          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-3 py-1.5">
            <span className="font-mono text-xs text-slate-400">
              Orbit Dev Log — {entries.length} entries
              {errorCount > 0 && <span className="ml-2 text-rose-400">{errorCount} errors</span>}
              {warnCount > 0 && <span className="ml-2 text-amber-400">{warnCount} warnings</span>}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200"
            >
              Close
            </button>
          </div>

          {/* Entries */}
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
            {entries.length === 0 ? (
              <span className="text-slate-500">No log entries yet.</span>
            ) : (
              entries.map((entry, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-all ${
                    entry.level === "error"
                      ? "text-rose-400"
                      : entry.level === "warn"
                        ? "text-amber-400"
                        : "text-slate-400"
                  }`}
                >
                  {formatEntry(entry)}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
