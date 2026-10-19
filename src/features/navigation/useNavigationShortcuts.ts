import { useEffect } from "react";
import { useNavigationStore } from "../../stores/navigationStore";

/**
 * App-wide navigation shortcuts:
 * Alt+← / Alt+→ and the mouse back/forward buttons walk history,
 * Ctrl/Cmd+, opens settings.
 */
export function useNavigationShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const nav = useNavigationStore.getState();
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft") {
        event.preventDefault();
        nav.back();
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowRight") {
        event.preventDefault();
        nav.forward();
      } else if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        nav.openSettings();
      }
    };

    // Buttons 3 and 4 are the mouse's back and forward side buttons.
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        useNavigationStore.getState().back();
      } else if (event.button === 4) {
        event.preventDefault();
        useNavigationStore.getState().forward();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);
}
