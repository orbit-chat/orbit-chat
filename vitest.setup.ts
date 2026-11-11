import sodium from "libsodium-wrappers-sumo";
import { afterEach } from "vitest";

// Every export in src/lib/crypto.ts awaits sodium.ready internally, but the WASM
// init is async and shared. Awaiting once here keeps individual tests free of
// initialisation races and makes failures point at the assertion, not at setup.
await sodium.ready;

// Component tests opt into jsdom with `// @vitest-environment jsdom`. Only those
// pay for Testing Library, the DOM matchers and the browser shims Radix needs.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  // Vitest runs without globals, so Testing Library cannot register this itself.
  afterEach(() => cleanup());

  // jsdom has no layout APIs; Radix's positioning and pointer handling call these.
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= function () {};
}
