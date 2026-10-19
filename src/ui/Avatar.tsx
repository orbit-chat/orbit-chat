import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "./cn";

export type Presence = "online" | "idle" | "dnd" | "offline";

const sizes = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
  xl: "h-20 w-20 text-xl"
} as const;

const presenceColor: Record<Presence, string> = {
  online: "bg-emerald-400",
  idle: "bg-amber-300",
  dnd: "bg-orbit-danger",
  offline: "bg-slate-500"
};

type AvatarProps = {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  presence?: Presence;
  className?: string;
};

/** Image avatar that falls back to the name's initial while loading or when the image fails. */
export function Avatar({ name, src, size = "md", presence, className }: AvatarProps) {
  const initial = name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <AvatarPrimitive.Root
        className={cn(
          "inline-flex items-center justify-center overflow-hidden rounded-full border border-white/10 bg-orbit-panelAlt font-semibold text-orbit-text",
          sizes[size]
        )}
      >
        {src && <AvatarPrimitive.Image src={src} alt="" className="h-full w-full object-cover" />}
        <AvatarPrimitive.Fallback delayMs={src ? 300 : 0}>{initial}</AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {presence && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-orbit-sidebar",
            presenceColor[presence]
          )}
          aria-label={presence}
          role="img"
        />
      )}
    </span>
  );
}
