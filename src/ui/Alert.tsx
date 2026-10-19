import type { ReactNode } from "react";
import { cn } from "./cn";

const tones = {
  danger: "border-orbit-danger/30 bg-orbit-danger/10 text-rose-300",
  warning: "border-orbit-warning/30 bg-orbit-warning/10 text-amber-200",
  info: "border-orbit-accent/25 bg-orbit-accent/10 text-orbit-text"
} as const;

/** Inline message box. Danger alerts are announced to screen readers when they appear. */
export function Alert({
  tone = "info",
  className,
  children
}: {
  tone?: keyof typeof tones;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}
