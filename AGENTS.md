# Repository Guidelines

## Project Structure & Module Organization

Orbit Chat is an Electron + React desktop client, with iOS and Android shells built on Capacitor (`android/`, `ios/`, the local secure-storage plugin in `native/secure-store`). Main application code lives in `src/`: UI in `src/components`, state in `src/stores`, API/crypto helpers in `src/lib`, and shared types in `src/types`. Anything that depends on the shell the renderer runs in (secure storage, device name, and later notifications, clipboard and file saving) goes through `src/platform` rather than `window.electronAPI` or `localStorage`, so the iOS/Android shells (`src/platform/capacitor.ts`, `docs/mobile-plan.md`) supply their own implementation. Electron entry points are in `electron/main.ts` and `electron/preload.ts`. Static assets live in `public`, release/notarization helpers in `scripts`, and production trust notes in `docs`. Build outputs are generated in `dist`, `dist-electron`, and `release`; do not edit those manually.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start the Vite/Electron development app.
- `npm run typecheck`: run TypeScript checks without emitting files.
- `npm run build`: compile TypeScript and build renderer plus Electron bundles.
- `npm run check`: run typecheck and production build together.
- `npm run dist:win` / `npm run dist:mac`: create platform installers/packages.
- `npm run release:publish`: publish release artifacts using `scripts/publish-release.mjs`.
- `npm run build:mobile`: build the renderer for the phone apps (strict CSP; needs HTTPS `VITE_API_URL`/`VITE_SOCKET_URL`, see `.env.mobile.example`).
- `npm run build:mobile:local`: the same phone build pointed at an orbit-server on this computer (`.env.mobile-local`), for testing over USB with `adb reverse tcp:3000 tcp:3000`. Only loopback addresses are accepted, and only Android debug builds allow plain HTTP to them.
- `npm run cap:sync`, then `npm run cap:android` / `npm run cap:ios`: copy that build into the native projects and open them in Android Studio (JDK 21) or Xcode. `.github/workflows/mobile.yml` compiles both unsigned on every PR; `mobile-release.yml` builds signed store builds from repository secrets only.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Keep two-space indentation, double quotes in TS/TSX files, and semicolons where the surrounding file uses them. Component files use `PascalCase.tsx`; stores use `camelCaseStore.ts`; helpers in `src/lib` use descriptive `camelCase.ts` names. Prefer existing Zustand stores and API helpers before adding new global state or fetch logic.

## Testing Guidelines

Tests run on Vitest and are required by CI — a failing suite blocks the build.

- `npm test`: run the suite once.
- `npm run test:watch`: watch mode while developing.
- `npm run check`: typecheck, then tests, then build. Every change should pass this.

Place specs beside the code under test in a `__tests__` directory (see `src/lib/__tests__/crypto.test.ts`). Import `describe`/`it`/`expect` explicitly from `vitest` rather than relying on globals, so files typecheck under `tsconfig.app.json` with no extra configuration.

`src/lib/__tests__/crypto.test.ts` is the highest-value file in the repo: it pins ciphertext integrity, key-version isolation, sealed-box targeting, and the chunked-attachment parser's handling of malformed input. Its negative cases matter more than its round-trips — a round-trip failure is obvious in the app, whereas silently accepting a tampered ciphertext is not. Any change to `src/lib/crypto.ts` needs coverage here.

Tests default to the `node` environment; store tests that need `localStorage` or DOM APIs opt in with a `// @vitest-environment jsdom` pragma at the top of the file.

For security-sensitive work, still manually exercise signup/login, socket reconnect, message send/receive, E2EE decrypt, attachments, passcode locks, and updater UI where relevant.

For device-key or phone work, also run through these on two real devices (or a desktop window plus a phone) against a server with `E2EE_PER_DEVICE=true`:

- Link a new device by QR code and by typed code: the 6-digit confirmation code matches on both screens, the new device shows "Linked", and older chats open there once history is shared.
- Cancel a link before confirming the code (from either side) and check nothing was added to Settings → Devices.
- Send in a DM and in a group from each device; the other side shows no "unverified sender" note, and safety numbers match on both sides.
- Remove a linked device from another one: the removed device is signed out and can no longer open the chats, and the remaining devices still send and read (the chats move to a new key).
- On a phone: the app switcher shows a blank screen, the app lock asks again after backgrounding, a push notification arrives with no message text in it, and Settings → Devices lists the phone with the right name.

## Commit & Pull Request Guidelines

Recent history mostly uses concise Conventional Commit-style messages such as `feat: implement pinned message functionality`; keep that style for feature and fix work. Use direct imperative summaries for operational commits when appropriate. PRs should include a short description, testing performed, screenshots or screen recordings for UI changes, and notes for config, signing, or release-impacting changes. Do not include generated `release` artifacts unless the PR is explicitly a release artifact update.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local API/socket/Giphy settings. Never commit signing certificates, Apple credentials, access tokens, private keys, recovery codes, or production API secrets. Review `SECURITY.md` and `docs/production-trust.md` before touching encryption, updater, signing, or crash-reporting behavior.
