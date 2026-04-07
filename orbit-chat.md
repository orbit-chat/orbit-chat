
```md
# frontend.md

# Encrypted Chat App — Frontend / Desktop Design

## Goal

Build a Windows desktop `.exe` chat app with:

- Discord-style desktop UI
- secure encrypted messaging
- disappearing messages
- one-time-view images
- real-time updates
- smooth chat experience

The frontend should be responsible for:
- user authentication
- local key handling
- encryption and decryption
- chat UI
- media viewing rules
- secure local caching

---

## Recommended Frontend Stack

## Desktop Shell
- **Electron**

Why:
- produces a Windows `.exe`
- mature ecosystem
- easy integration with React
- ideal for a Discord-like desktop interface

## UI Framework
- **React**
- **TypeScript**

Why:
- fast component development
- strong ecosystem
- easier state and view modeling
- same language as backend

## Styling
- **Tailwind CSS**
- optional component layer: **shadcn/ui** style approach or custom design system

Why:
- fast styling
- good for building a Discord-like app shell
- easy dark mode support

## State Management
- **Zustand**

Why:
- simpler than Redux
- easy for chat UI state
- works well with Electron + React

Use separate stores for:
- auth
- socket state
- conversations
- messages
- UI preferences
- ephemeral media state

## Data Fetching
- **TanStack Query**

Use for:
- conversation history
- profile fetches
- pagination
- retry logic
- cache invalidation

## Realtime Client
- **socket.io-client**

## Crypto
- **libsodium**
- preferred desktop approach: **sodium-native** or a maintained libsodium binding usable from Electron

Use for:
- keypair generation
- group key encryption
- message encryption
- attachment encryption
- memory wiping where possible

## Forms
- **React Hook Form + Zod**

## Local Persistence
- **IndexedDB** or **SQLite via Electron**
- plus secure OS key storage where possible

For a desktop chat app, **SQLite** is usually the better long-term choice.

---

## Recommended Language Choices

- UI: **TypeScript**
- Electron main/preload: **TypeScript**
- crypto helpers: **TypeScript** calling libsodium bindings
- native helper only if needed later: **Rust** or **C++**, but not for v1

Best v1:
- keep frontend entirely **TypeScript**

---

## Frontend Architecture Overview

```text
[ Electron Main Process ]
        |
        +--> window management
        +--> secure IPC
        +--> file dialogs
        +--> notifications
        +--> secure local db access (optional)
        |
[ Preload Script ]
        |
        +--> exposes safe IPC bridge
        |
[ React Renderer ]
        |
        +--> auth pages
        +--> app shell
        +--> chat UI
        +--> media viewer
        +--> settings
        +--> encryption/decryption orchestration