# Orbit Chat Frontend (Desktop)

Electron + React + TypeScript desktop client for Orbit Chat, packaged with electron-builder as a Windows installer (.exe).

## Current System Design

### Runtime architecture

```text
[ Electron Main Process ]
	- Creates and manages BrowserWindow
	- Registers IPC handlers (example: app:getVersion)
	- Controls external URL behavior and desktop shell concerns

[ Preload Script ]
	- Exposes a safe, minimal API to renderer through contextBridge
	- Keeps Node/Electron APIs out of untrusted renderer scope

[ React Renderer ]
	- Desktop chat UI
	- Auth/session state
	- Socket connection lifecycle
	- Message state and rendering
	- Crypto helper integration points
```

### Frontend stack in this repo

- Electron for desktop shell and Windows executable packaging
- React + TypeScript for renderer UI
- Tailwind CSS for styling
- Zustand for client state slices
- TanStack Query ready for server data fetching
- socket.io-client for realtime updates
- libsodium-wrappers for encryption/decryption primitives
- React Hook Form + Zod available for form validation workflows

### Key project structure

- electron/main.ts: Electron main process bootstrap and window creation
- electron/preload.ts: secure IPC bridge exposed to renderer
- src/App.tsx: current desktop chat shell UI
- src/stores/authStore.ts: auth/session state
- src/stores/socketStore.ts: socket lifecycle state
- src/stores/messagesStore.ts: in-memory message state
- src/lib/crypto.ts: libsodium helper utilities

### Backend relationship

- This repository is frontend-only desktop client code.
- Backend/server lives in a separate private repository.
- Configure backend endpoints via .env values.

## Environment Setup

1. Install dependencies:
	 - npm install --cache .npm-cache
2. Create environment file:
	 - cp .env.example .env
3. Set values in .env:
	 - VITE_API_URL
	 - VITE_SOCKET_URL

## Commonly Used Commands

### Development

- npm run dev
	- Starts Electron + Vite development runtime.

### Validation

- npm run typecheck
	- Runs TypeScript checks without emitting build output.

### Production builds

- npm run build
	- Builds renderer and Electron bundles into dist/ and dist-electron/.

- npm run dist
	- Builds and packages for the current OS.

- npm run dist:win
	- Builds and packages Windows NSIS x64 installer (.exe).

### Package management

- npm ci
	- Clean reproducible install from package-lock.json (recommended in CI).

- npm audit
	- Lists known dependency vulnerabilities.

## Windows .exe Output

Windows installer artifacts are created in:

- release/

Primary installer filename pattern:

- Orbit Chat Setup <version>.exe

## Recommended Build Flow For Distribution

1. Use a Windows machine or Windows CI runner.
2. Run npm ci.
3. Run npm run dist:win.
4. Publish the generated installer from release/.

## Next Integration Steps

- Replace quick sign-in with real auth API flow.
- Persist cryptographic keys and sessions securely on-device.
- Implement encrypted outbound/inbound message pipeline.
- Add disappearing messages and one-time-view media policy enforcement.
