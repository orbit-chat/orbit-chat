import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ContextMenu as ContextMenuPrimitive, DropdownMenu as DropdownPrimitive } from "radix-ui";
import { cn } from "./cn";

/*
 * Dropdown menus (opened from a button) and context menus (opened by right-click)
 * share item styling. Both are portalled, keyboard navigable (arrows, typeahead,
 * Enter, Escape) and close every other open menu when they open.
 */

const contentClass =
  "z-menu min-w-[190px] overflow-hidden rounded-xl border border-white/10 bg-orbit-overlay p-1 shadow-xl shadow-black/50 outline-none " +
  "data-[state=open]:animate-orbit-pop-in data-[state=closed]:animate-orbit-pop-out";

const itemClass =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-lg px-2.5 text-[13px] text-orbit-text outline-none " +
  "data-[highlighted]:bg-white/[0.08] data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

const dangerItemClass = "text-orbit-danger data-[highlighted]:bg-orbit-danger/15";

const separatorClass = "my-1 h-px bg-white/10";

type ItemExtras = { icon?: ReactNode; danger?: boolean; shortcut?: string };

function ItemBody({ icon, shortcut, children }: ItemExtras & { children: ReactNode }) {
  return (
    <>
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-orbit-muted">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="ml-4 font-mono text-[10px] text-orbit-muted">{shortcut}</span>}
    </>
  );
}

/* ─── Dropdown ─── */

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(contentClass, className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  icon,
  danger,
  shortcut,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> & ItemExtras) {
  return (
    <DropdownPrimitive.Item className={cn(itemClass, danger && dangerItemClass, className)} {...props}>
      <ItemBody icon={icon} shortcut={shortcut}>
        {children}
      </ItemBody>
    </DropdownPrimitive.Item>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className={separatorClass} />;
}

/* ─── Context menu ─── */

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export function ContextMenuContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content collisionPadding={8} className={cn(contentClass, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  icon,
  danger,
  shortcut,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & ItemExtras) {
  return (
    <ContextMenuPrimitive.Item className={cn(itemClass, danger && dangerItemClass, className)} {...props}>
      <ItemBody icon={icon} shortcut={shortcut}>
        {children}
      </ItemBody>
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuSeparator() {
  return <ContextMenuPrimitive.Separator className={separatorClass} />;
}
