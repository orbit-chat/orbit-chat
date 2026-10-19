import { forwardRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { Input, cn } from "../../ui";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** Password field with a show/hide toggle and a Caps Lock warning. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, onKeyUp, onBlur, ...props },
  ref
) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);
    onKeyUp?.(event);
  };

  return (
    <div>
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-14", className)}
          onKeyUp={trackCapsLock}
          onBlur={(event) => {
            setCapsLock(false);
            onBlur?.(event);
          }}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold text-orbit-muted hover:text-orbit-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {capsLock && <p className="mt-1 text-[11px] text-orbit-warning">Caps Lock is on.</p>}
    </div>
  );
});
