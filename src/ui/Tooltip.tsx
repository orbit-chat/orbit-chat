import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

/** Mount once near the root; lets adjacent tooltips open instantly after the first. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={250}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

type TooltipProps = {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Must be a single element that can hold a ref (Button, IconButton, …). */
  children: ReactNode;
};

export function Tooltip({ content, side = "top", children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="pointer-events-none z-tooltip max-w-xs rounded-md border border-white/10 bg-orbit-chrome px-2 py-1 text-[11px] font-medium text-orbit-text shadow-lg data-[state=delayed-open]:animate-orbit-fade-in data-[state=closed]:animate-orbit-fade-out"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
