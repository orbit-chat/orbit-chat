/**
 * Which interface the renderer mounts. The rebuilt UI is the default; the classic one
 * stays available as a fallback until it's removed.
 */
export type InterfaceChoice = "new" | "classic";

export const UI_PREFERENCE_KEY = "orbit:ui";

/**
 * Set (non-secret, localStorage) once this install has used per-device keys (mobile plan M1b).
 * The classic interface only speaks the legacy key protocol, so it isn't offered after that.
 */
export const PER_DEVICE_SEEN_HINT = "orbit:perDeviceSeen";

/** Whether the classic interface can still work on this install. */
export function classicInterfaceAvailable() {
  try {
    return localStorage.getItem(PER_DEVICE_SEEN_HINT) !== "1";
  } catch {
    return true;
  }
}

export function chosenInterface(): InterfaceChoice {
  if (!classicInterfaceAvailable()) return "new";
  // Build-time override, e.g. for comparing the two side by side.
  if (import.meta.env.VITE_UI === "classic") return "classic";
  try {
    return localStorage.getItem(UI_PREFERENCE_KEY) === "classic" ? "classic" : "new";
  } catch {
    return "new";
  }
}

/** Record that this install uses per-device keys; if the classic interface is running, reload into the new one. */
export function markPerDeviceKeysSeen() {
  const wasClassic = chosenInterface() === "classic";
  try {
    localStorage.setItem(PER_DEVICE_SEEN_HINT, "1");
    localStorage.removeItem(UI_PREFERENCE_KEY);
  } catch {
    return;
  }
  if (wasClassic) window.location.reload();
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
