import type { ComponentPropsWithoutRef } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "./cn";

/**
 * Anchored floating panel (pinned messages, search, pickers). Portalled to <body>
 * so it always paints above the message list and receives its own pointer events —
 * the old in-place popovers were trapped under a backdrop-blur header.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  sideOffset = 8,
  collisionPadding = 12,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-popover max-h-[var(--radix-popover-content-available-height)] overflow-hidden rounded-2xl border border-white/10 bg-orbit-overlay shadow-xl shadow-black/50 outline-none",
          "origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-orbit-pop-in data-[state=closed]:animate-orbit-pop-out",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
