import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, kept in step with the window. False where matchMedia doesn't exist. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false
  );
}

/** Below Tailwind's `md` breakpoint the app shows one pane at a time (mobile plan M2). */
export const COMPACT_QUERY = "(max-width: 767px)";

export function useCompactLayout() {
  return useMediaQuery(COMPACT_QUERY);
}
