import type { HTMLAttributes } from "react";
import { cn } from "./cn";

const tones = {
  neutral: "border-white/15 bg-white/[0.06] text-slate-200",
  accent: "border-orbit-accent/40 bg-orbit-accent/15 text-orbit-accent",
  danger: "border-orbit-danger/40 bg-orbit-danger/15 text-orbit-danger",
  warning: "border-orbit-warning/50 bg-orbit-warning/15 text-orbit-warning"
} as const;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones };

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

/** Small round unread counter; renders nothing at zero. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-orbit-accent px-1 text-[10px] font-bold text-slate-950",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center rounded border border-white/15 bg-orbit-panel px-1.5 font-mono text-[10px] text-orbit-muted",
        className
      )}
      {...props}
    />
  );
}
