import { useEffect, useState } from "react";
import { cn } from "../ui";

/** Frameless-window title bar: drag region plus minimize / maximize / close. */
export function TitleBar({ title = "Orbit Chat" }: { title?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI?.isMaximized().then(setMaximized).catch(() => {});
    return window.electronAPI?.onMaximizedChanged(setMaximized);
  }, []);

  const button =
    "inline-flex h-9 w-11 items-center justify-center text-orbit-muted/70 transition-colors duration-100 hover:bg-white/[0.08] hover:text-orbit-text focus-visible:outline-none focus-visible:bg-white/[0.08]";

  return (
    <div className="flex h-9 shrink-0 select-none items-center bg-orbit-chrome">
      <div className="flex flex-1 items-center px-3 [-webkit-app-region:drag] [app-region:drag]">
        <span className="text-[11px] font-semibold tracking-wide text-orbit-muted/70">{title}</span>
      </div>
      <div className="flex items-center [-webkit-app-region:no-drag] [app-region:no-drag]">
        <button type="button" onClick={() => window.electronAPI?.minimize()} className={button} aria-label="Minimize">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect y="5" width="12" height="1.5" rx=".75" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => window.electronAPI?.maximize()}
          className={button}
          aria-label={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect x="1.5" y="3" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3.5 3V2a1.5 1.5 0 0 1 1.5-1.5H10A1.5 1.5 0 0 1 11.5 2v5A1.5 1.5 0 0 1 10 8.5H9" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect x=".75" y=".75" width="10.5" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => window.electronAPI?.close()}
          className={cn(button, "hover:bg-red-500/90 hover:text-white")}
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
