/**
 * Which interface the renderer mounts. The rebuilt UI is the default; the classic one
 * stays available as a fallback until it's removed.
 */
export type InterfaceChoice = "new" | "classic";

export const UI_PREFERENCE_KEY = "orbit:ui";

export function chosenInterface(): InterfaceChoice {
  // Build-time override, e.g. for comparing the two side by side.
  if (import.meta.env.VITE_UI === "classic") return "classic";
  try {
    return localStorage.getItem(UI_PREFERENCE_KEY) === "classic" ? "classic" : "new";
  } catch {
    return "new";
  }
}

/** Remember the choice and reload into it. */
export function switchInterface(choice: InterfaceChoice) {
  try {
    if (choice === "classic") localStorage.setItem(UI_PREFERENCE_KEY, "classic");
    else localStorage.removeItem(UI_PREFERENCE_KEY);
  } catch {
    // Storage blocked: the reload just keeps the default.
  }
  window.location.reload();
}
