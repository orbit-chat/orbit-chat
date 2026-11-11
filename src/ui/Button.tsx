import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "radix-ui";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold " +
  "transition-[background-color,border-color,color,filter,transform] duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-orbit-base " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 " +
  // Touch screens (mobile plan M2): at least 44px to tap, whatever the visual size.
  "[@media(pointer:coarse)]:min-h-11";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-orbit-accent text-slate-950 shadow-[0_6px_20px_rgb(var(--orbit-accent)/0.28)] hover:brightness-110",
  secondary: "border border-white/10 bg-white/[0.06] text-orbit-text hover:border-white/20 hover:bg-white/[0.1]",
  ghost: "text-orbit-muted hover:bg-white/[0.07] hover:text-orbit-text",
  danger: "bg-orbit-danger text-white hover:brightness-110"
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3 text-sm",
  lg: "h-11 px-4 text-sm"
};

const iconSizes: Record<ButtonSize, string> = {
  sm: "h-7 w-7 [@media(pointer:coarse)]:min-w-11",
  md: "h-9 w-9 [@media(pointer:coarse)]:min-w-11",
  lg: "h-11 w-11"
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (e.g. a link) with button styling instead of a <button>. */
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", asChild, className, type, ...props },
  ref
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
});

export type IconButtonProps = Omit<ButtonProps, "asChild"> & {
  /** Required: icon-only buttons have no visible text. */
  label: string;
};

/** Square button for a single icon. `label` becomes the accessible name. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "md", label, className, type, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      className={cn(base, variants[variant], iconSizes[size], "p-0", className)}
      {...props}
    />
  );
});
