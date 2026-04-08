# Orbit Chat Desktop

Orbit Chat is an Electron desktop client built with React and TypeScript.

It provides:

- encrypted direct messages (E2EE payloads)
- realtime messaging over Socket.IO
- profile popovers and profile settings
- desktop packaging for macOS and Windows

This repository is the client app. The backend lives in `../orbit-server`.

## Current Features

- Login and signup with JWT session handling
- DM conversation list + live incoming messages
- User search with quick "Chat" action
- User profile popover (from search results, message sender, and top-right profile chip)
- Profile settings page (display name, bio, pronouns, timezone, presence, status, links, avatar, banner)
- E2EE DM message encryption/decryption using libsodium
- Electron desktop shell with secure preload bridge

## Tech Stack

- Electron 34
- Vite 6
- React 18 + TypeScript 5
- Tailwind CSS 3
- Zustand state stores
- Socket.IO client
- libsodium-wrappers

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and set values:

```env
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```

### 3. Run in development

```bash
npm run dev
```

## Scripts

- `npm run dev`: start Vite + Electron dev workflow
- `npm run typecheck`: TypeScript check only
- `npm run build`: production build (`dist/` + `dist-electron/`)
- `npm run check`: typecheck + build
- `npm run dist`: package app for current platform with Electron Builder
- `npm run dist:mac`: build macOS `dmg` + `zip`
- `npm run dist:win`: build Windows NSIS installer (`.exe`)
- `npm run release:publish`: upload build artifacts to GitHub Release and sync website downloads

## Release Publishing

`npm run release:publish` runs `scripts/publish-release.mjs`.

It:

1. reads version from `package.json`
2. finds matching artifacts in `release/`
3. creates or updates GitHub Release tag `v<version>`
4. uploads artifacts using `gh release upload --clobber`
5. copies installers into `../orbit-chat.github.io/downloads`
6. updates download links in `../orbit-chat.github.io/index.html`

Prerequisites:

- GitHub CLI installed (`gh`)
- authenticated (`gh auth login`)
- release artifacts already generated (`npm run dist`, `npm run dist:mac`, or `npm run dist:win`)

Dry run:

```bash
node scripts/publish-release.mjs --dry-run
```

## E2EE Model (Direct Messages)

Orbit Chat encrypts DM message content client-side.

- Message payloads use `crypto_secretbox_easy`.
- Per-conversation symmetric keys are sealed with recipient public keys via `crypto_box_seal`.
- Server stores encrypted conversation keys and ciphertext, but not plaintext messages.

Current behavior in code:

- Device private key is stored locally (per user) in `localStorage`.
- Existing device public key is re-published once per session to improve key availability.
- Conversation key bootstrap occurs when missing for a DM.
- Receiver decrypt path attempts available key versions from newest to oldest.

## Security Notes

- E2EE currently applies to DM message body payloads, not metadata.
- Group chats are not end-to-end encrypted yet.
- Key verification UX (fingerprints/QR) is not implemented yet.
- Private key storage uses renderer local storage, not OS keychain.
- No forward secrecy/ratchet protocol yet.

## Project Structure

- `electron/main.ts`: Electron main process and window lifecycle
- `electron/preload.ts`: safe renderer bridge APIs
- `src/App.tsx`: app shell, chat layout, compose/send flow, profile corner actions
- `src/lib/api.ts`: backend HTTP client wrappers
- `src/lib/crypto.ts`: libsodium crypto helpers
- `src/stores/authStore.ts`: auth/session state
- `src/stores/socketStore.ts`: socket lifecycle and inbound message events
- `src/stores/messagesStore.ts`: conversation message cache
- `src/stores/e2eeStore.ts`: device/conversation key lifecycle
- `src/stores/profilesStore.ts`: user profile fetch/update/upload state
- `src/components/ProfileSettings.tsx`: editable profile screen
- `src/components/UserProfilePopover.tsx`: profile card overlay

## Troubleshooting

### Stuck on "Setting up encryption"

- Ensure both users are on the latest desktop build.
- Sign out/in once on both devices to refresh session + key registration.
- Verify API and socket endpoints are reachable from both clients.

### Build succeeds but app fails to connect

- Confirm `.env` values match the running backend host.
- Confirm backend CORS and websocket transport allow desktop client origin.

### Profile image upload fails

- Backend requires S3 configuration for avatar/banner upload endpoints.

## License

Private/internal project unless otherwise specified by repository owner.
