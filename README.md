# Orbit Chat Desktop

Orbit Chat is a desktop messaging app focused on private communication.

Current desktop package version: `0.9.0`.

This app is designed so message text in direct and group chats is end-to-end encrypted. The backend delivers and stores encrypted payloads, but does not hold the private keys needed to read message content.

## What This Is

Orbit Chat combines:

- a desktop shell (Electron)
- a chat interface (React)
- realtime delivery (websockets)
- client-side cryptography (libsodium)
- profile viewing and editing UI (popover + settings)
- friend requests and friend list management
- account recovery code login and bypass flows
- recovery code lifecycle management (status, refresh, permanent disable with confirmation)
- per-chat passcode lock controls (on leave, on logout, timed, inactivity)
- two-party passcode disable approval and passcode re-enable generation flow
- encrypted attachment handling for images
- GIF search and attach flow (Giphy API)
- searchable emoji picker with recents + keyboard navigation
- expanded reactions with emoji + `:name:` shortcode support
- reaction details modal showing who reacted to each reaction
- Discord-style mention autocomplete (`@username`) with keyboard navigation
- mention highlighting with ping indicator styling in chat
- message-level context menu actions (reply, ping, thread, react, pin/unpin)
- chat-local message search with clickable jump-to-message results
- per-chat pinned messages panel with jump navigation
- client-side unread badge tracking that clears on active chat selection
- chat display names editable in per-chat settings
- DM fallback labels using `@username#chatId` when no custom chat name is set
- local archive/unarchive chat workflow with conversation context menu actions
- DM delete + unfriend flow and group leave flow with optional message wipe
- home/recent chats as default landing view with dedicated DM, Group Chats, Friends, and Archive tabs
- group member add flow with membership-change rekeying and history key-version access control
- server-side owner remove-member API with membership-change event fanout
- full-scene scroll handling for auth, lock, modal, and app-shell views
- client URL normalization safeguards for malformed API/socket base URLs
- avatar rendering across DM and friends surfaces with initials fallback
- frameless desktop shell with custom title bar window controls
- local pinned chat ordering and local pinned-message persistence

The desktop app talks to a separate backend service for identity, routing, persistence, and presence.

For local development, set `VITE_API_URL` and `VITE_SOCKET_URL` in `.env` (from `.env.example`) so desktop traffic points to your intended backend. GIF search uses Giphy via `VITE_GIPHY_API_KEY`.

## What Is Actually Encrypted

Encrypted end-to-end:

- direct message text payloads (DM content)
- group message text payloads (group content)
- attachment metadata embedded in encrypted message envelopes
- GIF links embedded in encrypted message envelopes
- attachment file keys wrapped inside encrypted message envelopes
- attachment file bytes uploaded as encrypted blobs
- `@mention` text as part of encrypted message payloads

Not encrypted end-to-end:

- who you talk to
- conversation membership
- message timestamps
- delivery and seen metadata
- profile data
- media reservation metadata used for routing/storage (for example object key, lifecycle status, content type)

In plain terms: the server can route messages and know chat structure, but should not be able to read encrypted message text.

## Why It Is Considered Safe

Orbit Chat uses a layered model:

1. Transport security protects data in transit.
2. End-to-end encryption protects chat content even if transport or storage is inspected.
3. Device private keys remain on client devices.

Core safety properties:

- Message ciphertext is created on sender device.
- Message ciphertext is decrypted on recipient device.
- Server stores encrypted conversation keys and encrypted messages.
- Server does not perform plaintext decryption of DM payloads.
- Group membership changes trigger key-version rotation and member-specific readable-version boundaries.
- Attachment bytes are encrypted on sender device before upload.
- Attachment bytes are decrypted on recipient device after download.
- Pasted links are encrypted as part of the DM message body, not parsed as separate plaintext media fields.

## Cryptography Model (Plain English)

There are two key types:

- Device keypair (public/private): one per device identity.
- Conversation key (symmetric): shared secret used to encrypt chat messages.

How a DM key is shared:

1. A random conversation key is generated.
2. That key is sealed separately to each participant's public key.
3. Server stores only the sealed versions.
4. Each device opens its own sealed copy using its private key.

How group key access is managed:

1. Group messages carry a key version.
2. Membership changes (add/remove/leave) rotate to a new group key version.
3. New members receive only the current sealed group key and start with that version as their minimum readable version.
4. History queries are constrained to each member's minimum readable key version.

How a message is sent:

1. Sender encrypts text with the conversation key.
2. Sender sends ciphertext + nonce.
3. Server relays/stores encrypted payload.
4. Recipient decrypts locally with the same conversation key.

How an attachment is sent:

1. Sender generates a random per-file key.
2. Sender encrypts file bytes in chunks using that file key.
3. Sender uploads encrypted bytes to media storage using a signed upload URL.
4. Sender encrypts the file key inside the DM envelope and sends media ID references with the message.
5. Recipient decrypts the DM envelope, retrieves the wrapped file key, downloads encrypted bytes, and decrypts locally.

Runtime behavior notes:

- If a conversation key is still being prepared on first receive, UI may briefly show encrypted fallback text, then decrypt once key material is available.
- First-time inbound DM messages are delivered in realtime without requiring a re-login refresh.
- Realtime duplicate safety delivery can arrive through both conversation and user rooms; client message upsert is id-based to prevent duplicate rows.
- Newer incoming key versions trigger local key refresh to keep membership-change rekeys in sync.
- Messages older than a member's readable key-version boundary are hidden from local decrypt/render.
- Encrypted attachment delivery supports chunked encryption and in-session retry reuse for images already uploaded.
- GIF picker search and selection supports keyboard navigation, active-item highlighting, and outside-click/Escape dismiss.
- Emoji picker supports search tags, recent emoji shortcuts, and keyboard navigation.
- Reaction input supports both direct emoji and `:name:` shortcode mapping.
- Reaction details modal lists participants per reaction on a message.
- Mention autocomplete supports arrow-key navigation and Enter/Tab insert.
- Message search is scoped to the active chat and results jump to message anchors.
- Message-level pin/unpin is available from the context menu, with a pinned panel in the chat header.
- Unread counters are maintained client-side and reset immediately when a conversation becomes active.
- Navigation now separates Home (recent chats), Direct Messages, Group Chats, Friends, and Archive surfaces.
- Chat settings support custom display names and passcode/lock updates in one panel.
- Chat settings include passcode disable-request approval and passcode re-enable generation events.
- New chat passcodes are shown once with deferred display handling for conversation lifecycle events.
- Locked/passcode prompts include the chat label so users can match the correct passcode to the correct DM instance.
- Friend data refreshes on focus/visibility and server `friendships_updated` events.
- Scene containers are scroll-safe on smaller viewports (auth, passcode, main shell columns, and settings modal).
- API and socket base URLs are normalized client-side to reduce config mistakes (for example accidental `/:port` formatting).
- Realtime transport starts with polling and upgrades to websocket for better proxy/firewall compatibility.
- Access tokens can be silently refreshed during API/socket auth failures to reduce forced re-logins.

## System Design

```text
Desktop App (Electron + React)
	|- Auth/session state
	|- Frameless title bar + desktop window controls
	|- Realtime socket client
	|- Home/DM/Group/Friends/Archive navigation surfaces
	|- Conversation context menu (archive/relock/delete or leave)
	|- Message context menu (reply/ping/thread/react/pin)
	|- Active-chat message search with jump-to-message results
	|- Per-chat pinned messages panel
	|- Mention autocomplete and ping highlighting
	|- URL-normalized API/socket endpoint handling
	|- E2EE key management
	|- Membership-change rekey handling (add/remove/leave)
	|- Per-member key-version decrypt boundary handling
	|- Recovery code display/login/management flows
	|- Chat passcode disable-approval + re-enable UX
	|- GIF + emoji composer workflows
	|- Reaction modal and emoji shortcode mapping
	|- Encrypt/decrypt message content
					|
					| HTTPS + WSS
					v
Orbit Backend (NestJS)
	|- Auth + user profiles
	|- Friend graph + friend request workflows
	|- Conversation membership + message storage
	|- Membership-change key rotation (group add/remove/leave)
	|- Per-member minimum readable key-version enforcement on history fetch
	|- Conversation delete/leave + optional message wipe behavior
	|- Chat display-name updates with uniqueness validation per user
	|- Encrypted conversation key storage
	|- Chat passcode verification + lock policy enforcement
	|- Passcode disable-request + re-enable event fanout
	|- Recovery-code assisted passcode bypass
	|- Media reservation, signed upload/download URL issuance, and lifecycle cleanup
	|- Realtime fanout (Socket.IO conversation room + user room safety net)
	|- Friend list refresh events (`friendships_updated`)
	|- Presence cache + media services

External API
	|- Giphy search API (GIF discovery only)
```

## Architecture View

```mermaid
flowchart LR
	A[Sender Desktop Client] -->|Encrypted payload| B[Orbit Server]
	B -->|Encrypted payload| C[Recipient Desktop Client]
	B -->|Safety-net emit to user room| C
	A -->|Socket send_message event| B
	A -->|Membership change rekey payloads| B
	A -->|GIF search query| G[Giphy API]
	G -->|GIF URLs and previews| A
	A -->|Sealed conversation key for sender| B
	A -->|Sealed conversation key for recipient| B
	B -->|History filtered by member min key version| C
	A -->|Passcode disable/reenable requests| B
	A -->|Encrypted attachment bytes| B
	B -->|Encrypted attachment bytes| C
	B -. cannot decrypt payload without private keys .- B
```

## Example Message Flow

```mermaid
sequenceDiagram
	participant S as Sender Client
	participant API as Orbit Server
	participant R as Receiver Client

	S->>S: Ensure conversation key exists and key version is current
	S->>S: Compose text/emoji with optional @mentions and GIF link
	S->>S: Encrypt plaintext -> ciphertext + nonce
	S->>API: Emit send_message via Socket.IO
	API->>R: Emit to conversation room
	API->>R: Emit to user room safety-net
	API-->>S: Ack + persisted metadata
	R->>API: Fetch allowed history window by min key version
	R->>R: Decrypt locally using conversation key
	R->>R: Resolve chat label (custom name or username#chatId)
	R->>R: Render plaintext, mentions, reactions, and pin/search state in UI
```

## Media Encryption Flow

```mermaid
sequenceDiagram
	participant S as Sender Client
	participant API as Orbit Server
	participant OBJ as Object Storage
	participant R as Receiver Client

	S->>S: Generate per-file symmetric key
	S->>S: Encrypt file bytes in chunks
	S->>API: Request media upload reservation
	API-->>S: Return mediaId + signed upload URL
	S->>OBJ: Upload encrypted blob bytes
	S->>S: Wrap file key inside encrypted DM envelope
	S->>API: Send encrypted message + mediaIds
	API->>R: Realtime message event with ciphertext metadata
	R->>R: Decrypt DM envelope, recover wrapped file key
	R->>API: Request signed media download URL
	API-->>R: Signed download URL (member-gated)
	R->>OBJ: Download encrypted blob bytes
	R->>R: Decrypt bytes locally and render attachment
```

## Detailed Client Runtime Flow

```mermaid
flowchart TD
	A[App Boot: Electron window + React mount] --> A1[Initialize frameless title bar controls]
	A1 --> B[Load persisted auth + profile cache]
	B --> C{Access token valid?}
	C -- No --> D[Show auth UI / login]
	D --> D1[Support password login or recovery code login]
	C -- Yes --> E[Hydrate stores: auth, socket, messages, profiles, e2ee]
	E --> E2[Load friend/request state + unread counters]
	E --> F[Initialize libsodium + device key material]
	F --> G[Open Socket.IO session with JWT]
	G --> G1[Start polling transport, then upgrade websocket]
	G1 --> H[Join user room and active conversation rooms]
	H --> H1[Normalize API/socket base URLs from env config]
	H1 --> H2[Listen for friendships_updated and realtime message events]
	H2 --> H3[Handle conversation_created, member_added, member_left, member_removed, chat_settings_updated, passcode_reenabled, conversation_deleted]
	H2 --> I[REST fetch: conversations + message history]
	I --> J[For each conversation: resolve sealed key material]
	J --> K[Unseal key locally with device private key]
	K --> L[Decrypt ciphertext messages in memory when keyVersion >= member minimum]
	L --> M[Render timeline]
	M --> M1[Apply mention highlighting + ping indicators]
	M1 --> M2[Resolve chat label custom name or username#chatId]
	M2 --> M3[Conversation context menu supports archive/relock/delete/leave]
	M2 --> M4[Message context menu supports reply/ping/thread/react/pin]
	M4 --> M5[Pinned messages panel + active-chat message search jump list]
	M5 --> N[User sends message]
	N --> O{Has attachment?}
	O -- No --> P[Encrypt plaintext with conversation key and nonce]
	O -- Yes --> P2[Encrypt attachment chunks + upload encrypted blob]
	P2 --> P3[Embed wrapped file key and media IDs in encrypted envelope]
	P3 --> P[Emit encrypted payload over socket]
	P --> Q[Receive socket ack/new-message events]
	Q --> R[Update local stores + reconcile optimistic UI]
	R --> S[Maintain scrollable scene containers and modal panels]
	S --> T[Profile settings + recovery code management + chat passcode lifecycle controls]
```

## Detailed Server Processing Flow

```mermaid
sequenceDiagram
	participant C as Client (Desktop)
	participant G as Guards (JWT + membership)
	participant API as NestJS Controllers/Services
	participant DB as Postgres (Prisma)
	participant RC as Redis Cache/Presence
	participant RT as Socket.IO Gateway
	participant OBJ as Object Storage
	participant GF as Giphy API

	C->>GF: GIF search request (query)
	GF-->>C: GIF URLs + previews

	C->>API: POST media/upload-url(conversationId, contentType, size)
	API->>G: Validate token + conversation access
	G-->>API: Authorized
	API->>DB: Create pending media reservation
	API-->>C: mediaId + signed upload URL
	C->>OBJ: PUT encrypted media bytes

	C->>RT: Socket send_message(ciphertext, nonce, keyVersion, mediaIds)
	RT->>G: Validate token + conversation access
	G-->>RT: Authorized
	RT->>DB: Persist encrypted message row
	RT->>DB: Attach pending media rows by mediaId
	RT->>DB: Update conversation last activity
	RT->>RT: Emit to conversation room + user-room safety net
	RT-->>C: Ack/new_message events

	C->>API: PUT conversations/:id/settings (name/passcode/lock updates)
	API->>DB: Validate name uniqueness for request user scope
	API->>DB: Persist updated chat display name and lock settings
	API->>RT: Emit chat_settings_updated

	C->>API: POST conversations/:id/request-disable-passcode or /reenable-passcode
	API->>DB: Update passcode state and pending approvals
	API->>RT: Emit passcode lifecycle events (passcode_reenabled, updates)

	C->>API: POST conversations/:id/delete or /leave
	API->>DB: Apply membership delete/leave/remove + optional message wipe rules
	API->>DB: Rotate group key version on membership changes
	API->>DB: Enforce min-readable key version constraints for each member
	API->>RT: Emit conversation_deleted or member_left

	C->>API: POST auth/login/recovery + recovery-code management endpoints
	API->>DB: Validate or rotate/disable one-time recovery codes

	C->>API: GET users/friends + users/friends/requests
	API->>RT: Emit friendships_updated on friendship mutations
	API->>RC: Update unread/presence counters (if enabled)

	Note over API,DB: Conversation keys are stored sealed per user/device
	Note over API: Server routes ciphertext and metadata, not plaintext DM content
```

## Trust Boundaries

Client is trusted for:

- plaintext handling
- key generation
- encryption and decryption

Server is trusted for:

- auth decisions
- access control and membership checks
- storage durability
- message routing/realtime delivery (including first-time DM recipient fanout)
- media reservation and signed URL issuance
- one-time media lifecycle cleanup

Server is not trusted for:

- reading plaintext DM content

## Important Limits (Honest Security Notes)

- Group E2EE currently depends on centralized membership enforcement and server-coordinated key distribution metadata.
- Metadata is still visible to backend.
- Private keys are currently stored in local app storage, not OS keychain.
- Fingerprint verification between users is not implemented.
- Forward secrecy and ratcheting are not implemented yet.
- GIF discovery uses Giphy search endpoints (client-side query to external API).
- Attachment reservation metadata is handled server-side for access control and lifecycle management.
- Pinned chats and pinned messages are currently local-only (localStorage) and are not synced across devices.
- Very large desktop installers are currently distributed as direct release artifacts, which may require LFS/CDN strategy over time.
- In-app desktop auto-update flow is not enabled yet; users still install updates from release artifacts.
- Current build config forces `libsodium-wrappers` to its CommonJS entry due to an upstream ESM packaging issue.

## Product Summary

Orbit Chat is a desktop-first secure messaging client where direct and group chat content is encrypted on-device and decrypted on-device, with backend infrastructure focused on identity, routing, and encrypted data transport rather than plaintext access.
