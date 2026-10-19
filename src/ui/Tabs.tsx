import type { ComponentPropsWithoutRef } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "./cn";

/** Accessible tabs (arrow keys move between triggers). Styled as a segmented control. */
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex rounded-xl border border-white/10 bg-orbit-panelAlt p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-semibold text-slate-300 transition-colors duration-150",
        "hover:text-orbit-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
        "data-[state=active]:bg-orbit-accent data-[state=active]:text-slate-950",
        className
      )}
      {...props}
    />
  );
}
