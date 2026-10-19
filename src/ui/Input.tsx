import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const fieldBase =
  "w-full rounded-lg border border-white/10 bg-orbit-panelAlt px-3 text-sm text-orbit-text outline-none " +
  "placeholder:text-orbit-muted/70 transition-[border-color,box-shadow] duration-150 " +
  "focus:border-orbit-accent/80 focus:ring-2 focus:ring-orbit-accent/25 disabled:opacity-60 " +
  "aria-[invalid=true]:border-orbit-danger/70 aria-[invalid=true]:focus:ring-orbit-danger/25";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn(fieldBase, "h-9", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref
) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-[84px] resize-y py-2", className)} {...props} />;
});

type FieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  /** Receives the generated id plus aria wiring so label, hint and error stay connected. */
  children: (field: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
};

/** Label + control + hint/error, with ids wired for screen readers. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error && (
        <p id={hintId} className="text-[11px] text-orbit-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-[11px] text-orbit-danger">
          {error}
        </p>
      )}
    </div>
  );
}
