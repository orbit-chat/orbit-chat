# Repository Guidelines

## Project Structure & Module Organization

Orbit Chat is an Electron + React desktop client. Main application code lives in `src/`: UI in `src/components`, state in `src/stores`, API/crypto helpers in `src/lib`, and shared types in `src/types`. Electron entry points are in `electron/main.ts` and `electron/preload.ts`. Static assets live in `public`, release/notarization helpers in `scripts`, and production trust notes in `docs`. Build outputs are generated in `dist`, `dist-electron`, and `release`; do not edit those manually.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start the Vite/Electron development app.
- `npm run typecheck`: run TypeScript checks without emitting files.
- `npm run build`: compile TypeScript and build renderer plus Electron bundles.
- `npm run check`: run typecheck and production build together.
- `npm run dist:win` / `npm run dist:mac`: create platform installers/packages.
- `npm run release:publish`: publish release artifacts using `scripts/publish-release.mjs`.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Keep two-space indentation, double quotes in TS/TSX files, and semicolons where the surrounding file uses them. Component files use `PascalCase.tsx`; stores use `camelCaseStore.ts`; helpers in `src/lib` use descriptive `camelCase.ts` names. Prefer existing Zustand stores and API helpers before adding new global state or fetch logic.

## Testing Guidelines

There is no dedicated test runner configured yet. For now, every change should pass `npm run check`. For security-sensitive work, manually exercise signup/login, socket reconnect, message send/receive, E2EE decrypt, attachments, passcode locks, and updater UI where relevant. If tests are added later, place them beside the module or under a clear `tests` directory and document the new command here.

## Commit & Pull Request Guidelines

Recent history mostly uses concise Conventional Commit-style messages such as `feat: implement pinned message functionality`; keep that style for feature and fix work. Use direct imperative summaries for operational commits when appropriate. PRs should include a short description, testing performed, screenshots or screen recordings for UI changes, and notes for config, signing, or release-impacting changes. Do not include generated `release` artifacts unless the PR is explicitly a release artifact update.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local API/socket/Giphy settings. Never commit signing certificates, Apple credentials, access tokens, private keys, recovery codes, or production API secrets. Review `SECURITY.md` and `docs/production-trust.md` before touching encryption, updater, signing, or crash-reporting behavior.
