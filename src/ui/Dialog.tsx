import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "./cn";

/**
 * Modal dialog. Rendered in a portal on <body>, so no ancestor stacking context
 * (backdrop-blur, transforms, overflow) can clip it or sit on top of it.
 * Radix handles the focus trap, Escape, outside click, scroll lock and makes
 * the rest of the app inert to the pointer and screen readers while open.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const widths = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl"
} as const;

type DialogContentProps = {
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof widths;
  /** Footer row, typically Cancel + confirm buttons. */
  footer?: ReactNode;
  /** Block Escape / outside click, e.g. while a destructive request is in flight. */
  dismissible?: boolean;
  className?: string;
  children?: ReactNode;
};

export function DialogContent({
  title,
  description,
  size = "md",
  footer,
  dismissible = true,
  className,
  children
}: DialogContentProps) {
  const block = (event: Event) => {
    if (!dismissible) event.preventDefault();
  };

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="fixed inset-0 z-dialog bg-slate-950/70 backdrop-blur-sm data-[state=open]:animate-orbit-fade-in data-[state=closed]:animate-orbit-fade-out"
      />
      <div className="pointer-events-none fixed inset-0 z-dialog flex items-center justify-center p-4">
        <DialogPrimitive.Content
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          // Without a description Radix warns unless this is explicitly undefined.
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "pointer-events-auto flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-orbit-dialog shadow-[0_24px_70px_rgba(0,0,0,0.55)] outline-none",
            "data-[state=open]:animate-orbit-pop-in data-[state=closed]:animate-orbit-pop-out",
            widths[size],
            className
          )}
        >
          <div className="px-6 pt-5">
            <DialogPrimitive.Title className="text-base font-bold text-orbit-text">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-1 text-sm text-orbit-muted">{description}</DialogPrimitive.Description>
            )}
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}
