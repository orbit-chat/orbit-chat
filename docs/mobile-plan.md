# Orbit mobile plan (iOS + Android)

Goal: ship Orbit on iOS and Android with as little duplicated work as possible, without
weakening the security model or the design. This doc records the approach, the blockers
found in the current code, and the phases. Tick items off as they land, like the UI rework plan.

## 1. Approach: one renderer, three shells (Capacitor)

The rebuilt UI (`src/app`, `src/features`, `src/ui`), the crypto (`src/lib/crypto.ts`), the API
client and the stores are plain TypeScript/React with no Electron dependency. The only Electron
coupling is `window.electronAPI` (window chrome, updater) and where secrets are stored.

**Recommendation: Capacitor.** It runs the same Vite build inside native iOS (WKWebView) and
Android (System WebView) shells, with native plugins for the parts a web view can't do safely
(Keychain/Keystore, push, biometrics, screen protection, camera for QR linking). One codebase
serves desktop, iOS and Android, so every feature and fix lands on all three at once.

| Option | Reuse | Extra work | Verdict |
| --- | --- | --- | --- |
| Capacitor | UI, crypto, API, stores (~all) | responsive layout, native plugins | **Chosen**: least work, one design system |
| React Native / Expo | crypto, API, stores | rewrite every screen, swap libsodium build | Better native feel, ~2× the UI work, two UIs to keep in sync |
| Swift + Kotlin | nothing | everything twice | Only if a web view is ruled out |

Security note on web views: the shell loads only bundled files (no remote code, no `server.url`
in production), runs a strict CSP, and keeps secrets in native secure storage. That is the same
posture as the Electron app (sandboxed renderer, context isolation), not a weaker one.

If the design bar later demands fully native screens, the work below still carries over: the
platform layer, the server changes and the crypto are what a React Native app would reuse.

## 2. Blockers — must be fixed before any mobile build ships

These are in today's protocol and affect desktop too, but a second device per user (the phone)
turns them from latent into user-visible, so they come first.

Ground rule for everything below: **private keys never leave the device that generated them.**
Each device has its own keypairs. A new device gets access to chats only because an existing
device the user controls vouches for it (B6) through a channel the server can't tamper with (B7).
The server is treated as untrusted for key distribution: it stores and relays, it never decides
who can decrypt.

**B1, B5, B6, B7 and B8 ship together.** Per-device sealing without device signatures (B6) is
worse than today: anyone who can publish a key for an account (the server, a stolen access token,
a used recovery code) would automatically receive every contact's conversation keys.

### B1. Encryption is single-device per user (critical)
`ConversationKey` is unique on `(conversation, user, keyVersion)`: each user gets **one** sealed
copy of each conversation key, sealed to whichever public key was newest. Signing in on a phone
creates a new keypair, so:
- the phone can't read any existing conversation (keys were sealed to the desktop key);
- new DMs/rotations seal to the phone's (newest) key only, so the **desktop** loses access;
- `UserPublicKey` isn't tied to a `Device`, so there's no way to tell keys apart or revoke one.

Fix (server + client): make keys per device.
- `UserPublicKey` gets a `deviceId` (and `revokedAt`); `GET /users/:id/keys` returns the user's
  signed device list (B6), not a bare key list.
- `ConversationKey` becomes unique on `(conversation, device, keyVersion)`; senders seal to
  **every device in each member's verified device list** (`sealForMembers`,
  `ensureConversationSecretKey`, group create/add/remove/leave). Devices missing from a valid
  signed list get nothing, whatever the server returns.
- Device key registration is idempotent per device. Today the client re-publishes its key every
  session (`src/stores/e2eeStore.ts:76`) and the server always inserts a new row
  (`orbit-server/src/modules/users/users.service.ts:406`), so `user_public_keys` fills with
  duplicates. Publish once at device registration; the server upserts on `deviceId` and rejects
  a different key for an existing device.
- New-device history comes only from linking (B7). Recovery-code or password sign-in alone never
  grants history or keys.
- Migration: existing keys are attributed to the user's existing desktop device (the newest key
  row per user; older duplicate rows are dropped).

### B2. Device identity is the device *name* (critical)
The server upserts `Device` by `(userId, deviceName)` and every desktop sends `"Orbit Desktop"`.
Two devices with the same name share one row and one refresh-token hash, so signing in on the
second silently logs the first out, and the per-device key work in B1 has nothing to key on.
Fix: the client generates a random install ID once, stores it in secure storage, and sends it on
signup/login; the server keys `Device` on it. `deviceName` becomes a display label only.
`Device` gets a `status`: `pending` (signed in, not linked) or `trusted` (in the signed device
list). Pending devices can't fetch conversation keys, can't send, and aren't shown to contacts.
Add a "Devices" list in Settings → Privacy with link and revoke (B8).

### B3. No TLS (critical)
The client talks to `http://147.135.31.128:3000`. iOS App Transport Security and Android's
cleartext policy block plain HTTP, and tokens/ciphertext metadata travel in the clear today.
Fix: put the server behind HTTPS/WSS on a real hostname (Caddy is already on the host), set
`VITE_API_URL`/`VITE_SOCKET_URL` to it, and make mobile builds refuse non-`https` URLs.
Pin nothing until there's a stable hostname; consider certificate pinning after.

### B4. Secrets at rest are plaintext (high)
The device private key is in `localStorage` (`orbit:privateKey:<userId>`). Any process reading
the profile directory gets it. Mobile web-view storage is not acceptable for this.
Fix: `SecureStore` (added in M0) backed by:
- iOS Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, excluded from backups. Put the
  items in a shared Keychain access group from day one so the Notification Service Extension
  (M4 encrypted previews) can read them later without a migration.
- Android: an AES-GCM key held in the Android Keystore (non-exportable, StrongBox when available)
  wrapping the stored secrets. Don't build on Jetpack `EncryptedSharedPreferences`; the
  `androidx.security:security-crypto` library is deprecated. Check the Capacitor plugin chosen
  for this does the Keystore wrapping itself rather than depending on that library.
- Desktop moves to Electron `safeStorage` with a one-time migration that keeps the localStorage
  copy until the new copy reads back correctly (losing this key means losing history).

The store now holds three secrets per device: the device encryption key, the device signing key
and the identity key (B6). All three use the same protection.

### B5. Any member can overwrite another member's sealed key (high)
`POST /keys` upserts (`orbit-server/src/modules/keys/keys.service.ts:27`) and its `update` branch
replaces `encryptedGroupKey` for any target member. A malicious member (or the server) can swap
someone's key for a version, and the victim would decrypt — and encrypt — with a key the
attacker chose.
Fix:
- Keys are write-once (`create`, reject if present). A member may only write keys for other
  members' devices as part of a rotation it performs (new `keyVersion`), or for its own new
  device during linking (B7).
- Every key envelope is signed (no longer "later"; B6 makes this possible): the issuing device
  signs `orbit/key-envelope/v1 ‖ conversationId ‖ keyVersion ‖ recipientDeviceId ‖ sealedKey`
  with its device signing key and the row stores `issuerDeviceId` + `signature`. The recipient
  rejects the envelope unless the issuer is in the verified device list of a current member.

### B6. No device trust: keys are trusted blindly (critical)
Today there are no signing keys anywhere: only X25519 box keys, and `crypto_box_seal` is
anonymous (`src/lib/crypto.ts:64`). Clients seal to whatever public key the server returns, and
the server (or a stolen access token, via `POST /users/me/keys`) can add a key and read new
messages. A per-device key set also has nothing stable to fingerprint, so safety numbers can't
work without a fixed identity.

Fix: cross-signing, the model Matrix and WhatsApp multi-device use.
- **Identity key** per user: Ed25519, generated on the first device at signup. Its fingerprint is
  the user's safety number. The private half lives only in the secure store of the user's trusted
  devices and is handed to a new device only through linking (B7). Every trusted device holds it,
  so any of them can link or revoke; compromising one device already exposes all chats, so
  limiting it to one "primary" device would add little and lose recovery options.
- **Device keys** per device: the existing X25519 encryption key plus a new Ed25519 device
  signing key.
- **Signed device list**: `{ userId, version, devices: [{ deviceId, encPub, signPub, name, addedAt }] }`
  signed by the identity key with context `orbit/device-list/v1`. `version` only goes up; clients
  remember the highest version seen per contact and reject older lists, so the server can't
  replay a list that still contains a revoked device.
- **Contacts pin identity keys.** First sight is trust-on-first-use. Users can compare safety
  numbers (shown as digits and a QR) to mark a contact verified.
  - New device on a contact's list (valid signature): a notice in the chat ("Alex added a new
    device"), no block.
  - Contact's **identity key** changed: a prominent warning in every shared chat, and the client
    stops sealing new keys to that user until the warning is acknowledged. Verified contacts
    drop back to unverified.
- Adding a device to the list requires a trusted device's identity key, so a password, access
  token or recovery code is no longer enough to read anything.
- Existing users: on first launch after the upgrade the desktop generates the identity key and
  device signing key and publishes list v1. Contacts pin it silently (one-time "Orbit security
  upgrade" notice, not a key-change warning), since there was no identity to compare against.

### B7. Device linking: QR or typed code (critical)
A new device signs in normally (password, or recovery code), which only creates a `pending`
device. To unlock chats, the user links it from a device that is already trusted. Approving
through a server-delivered prompt alone is not safe: the server could put its own device behind
the prompt. So the secret that authenticates the link always travels screen-to-camera or
screen-to-keyboard, never through the server.

Roles: **E** = existing trusted device, **N** = new pending device. The server only relays opaque
messages for a linking session: one active session per account, 2-minute TTL, single use,
at most 5 sessions per account per hour, each attempt logged in the Devices list.

**QR mode (camera).**
1. E opens "Link a device" and shows a QR code containing
   `{ v: 1, sessionId, eDeviceId, eSignPubFingerprint, secret }`, where `secret` is 32 random bytes.
   Either side can show it: phones usually scan a desktop's screen, but a desktop being linked
   from a phone can show the QR instead and the phone scans it, with the same protocol (the
   device that shows the code is the one that created the session).
2. N scans it and derives `k = KDF(secret, "orbit/link/v1")`.
3. N → E: `{ nDeviceId, nEncPub, nSignPub, nName }`, authenticated and encrypted with `k`.
4. E checks the authentication. Both screens show the new device's name and a 6-digit confirmation
   code derived from the transcript hash; the user confirms on E.
5. E publishes the next device list version with N added (signed with the identity key).
6. E → N: an envelope sealed to `nEncPub`, encrypted with `k` and signed with E's device signing
   key, containing the identity private key, the new device list, and **every version of every
   conversation key E holds**. N checks E's signature against the fingerprint from the QR.
7. N stores the keys, writes its own signed `ConversationKey` rows (B5), and the server marks it
   `trusted`. The session is burned; a second use of the same secret is rejected.

**Typed mode (no camera).** E shows a code like `K7QM-2XRP`: 8 characters of Crockford base32
(40 bits, case-insensitive, no 0/O or 1/I/L confusion). The user types it on N. N finds the
session through the account (one active session per account), so the code carries no IDs.

A short code can't be used as a key directly: whoever relays the messages (the server) could
brute-force 40 bits offline in seconds. So the typed mode runs **CPace** (a password-authenticated
key exchange, `draft-irtf-cfrg-cpace`, ristretto255 + SHA-512) with the code as the password and
`userId ‖ sessionId` as the channel identifier. The CPace output replaces `k`, and steps 3–7 are
the same as QR mode, with key confirmation taking the place of the QR fingerprint check.
- An attacker in the middle gets exactly **one guess per session**. A failed key confirmation
  kills the session immediately, and both devices say "Linking failed. If you typed the code
  correctly, someone may have tried to intercept it." With 40 bits, one guess per session and
  5 sessions per hour, guessing is not a realistic attack.
- CPace needs `crypto_core_ristretto255_from_hash` and `crypto_scalarmult_ristretto255`, which
  are only in the sumo build. Switch `libsodium-wrappers` to `libsodium-wrappers-sumo` (same API,
  bigger bundle). Implement the draft exactly and pin its published test vectors in
  `src/lib/__tests__/crypto.test.ts`; don't improvise the construction.

**If no trusted device is left**, linking is impossible; see B10.

### B8. Revoking a device must rotate keys (critical)
A revoked or stolen device still holds every conversation key it ever received, and anything
sealed to it later is readable by whoever has it. Revoke (from Settings → Devices on any trusted
device) does all of:
- publishes the next device list version without the device (signed by the identity key);
- revokes the device's refresh token and marks its `UserPublicKey` `revokedAt`;
- rotates every conversation the user is in: new `keyVersion`, sealed only to the devices in the
  members' current verified lists. Contacts' clients that see a member's list shrink also rotate
  before their next send, so rotation doesn't depend on the revoking device staying online.
- Revoking the device you are on is "sign out and forget this device": it wipes the local secure
  store after publishing the list.

### B9. Messages aren't signed (high)
All members share one symmetric conversation key (`crypto_secretbox`), so any member's device can
write a message that the app attributes to another member; the sender is whatever the server
says. Every extra device widens this.
Fix: the sending device signs
`orbit/message/v1 ‖ conversationId ‖ keyVersion ‖ messageId ‖ nonce ‖ ciphertext` with its device
signing key; the message carries `senderDeviceId` + `signature`. Receivers verify that the device
is in the sender's verified device list and show "unverified sender" otherwise. Attachments sign
the hash of the encrypted manifest. Messages sent before the upgrade show as legacy/unverified,
not as errors.

### B10. Losing every device (decision needed)
Since sign-in alone grants no history (B1), losing all trusted devices means the account can sign
in but can't link. The only way forward is **reset identity**: a new identity key and device list
v1 on the new device. Contacts get the identity-change warning (B6), and old history is gone.
The reset needs the password **and** a recovery code, and every shared chat shows that the
identity was reset.
Optional, decided in §4: an encrypted key backup so history survives losing every device. It
would be encrypted with a separate high-entropy backup key the user stores (never derived from
the login recovery codes or the password, which the server sees or verifies), and the server
stores only ciphertext.

## 3. Phases

### M0 — Platform layer (framework-independent) ✅ done
- [x] `src/platform`: `Platform { kind, deviceName, secureStore }`, detected for desktop/web,
      installable by a mobile shell via `setPlatform()`.
- [x] Device private key goes through `secureStore` (desktop still uses localStorage, same key,
      no migration needed yet).
- [x] Sign-in uses one code path for the device keypair; concurrent callers can no longer
      generate two keypairs on a fresh device.
- [x] Server URLs in one place (`src/lib/serverConfig.ts`).
- [x] Route the remaining shell-specific calls through the platform: notifications
      (`useNotifications`), clipboard, file save (recovery codes, attachments), open external link,
      app version/updater (`useDesktop`), camera/QR scanning (B7). `Platform` now carries
      `notifications`, `requestAttention`, `clipboard`, `saveFile`, `openExternal`, `appInfo`,
      optional `updater` and optional `scanQrCode`; `src/platform/browser.ts` is the
      Electron/web implementation and `setPlatform()` takes partial overrides, so a mobile shell
      replaces only what its plugins do. Links use `externalLinkProps`, downloads
      `downloadLinkProps`. Only `TitleBar` (Electron window chrome, hidden on mobile) still talks
      to `window.electronAPI`. The classic UI (`src/App.tsx`, `src/components`) was left as is:
      it's the desktop-only fallback and won't ship in the mobile shells.

### M1 — Server and protocol prerequisites (B1–B10)
B1, B5, B6, B7 and B8 land together, behind one server-side switch that stays off until all of
them pass.
- [ ] HTTPS/WSS endpoint and client config (B3). Client side done (2026-11-11): mobile builds
      refuse a non-HTTPS API or socket address with a blocking screen (`insecureServerProblem` in
      `src/lib/serverConfig.ts`). Still needed: the production hostname (§4 open decision 2), a
      Caddy site for it, and `VITE_API_URL`/`VITE_SOCKET_URL` pointing at it.
- [x] Install ID: client creates it once in the secure store (`getInstallId` in `src/platform`) and
      sends it on signup/login/recovery; server keys `Device` on `(userId, installId)`, keeps
      name-based lookup for older clients, and the first install-ID sign-in claims the legacy row (B2).
      **Deploy the server before the client**: the validation pipe rejects unknown fields, so an
      older server refuses sign-ins that carry `installId`.
- [x] `Device` `pending`/`trusted` status; devices list in Settings → Privacy (B2). Status is
      derived, not stored: a device is trusted when it's on the account's current signed list
      (`GET /identity/me/devices`, `IdentityService.listDevices`), so it can't drift from the
      list. Settings → Privacy → Devices shows linked/not linked/signed out, flags unlinked
      sign-ins, and explains this device's own `pending`/`conflict` state. Enforcement (pending
      devices get no keys and can't send) switches on with B1, not before: today a second
      desktop would lose access to its chats.
- [x] Secure storage on desktop via `safeStorage`, with migration (B4). `electron/secureStore.ts`
      keeps an encrypted `secure-store.json` in userData (atomic writes, `orbit:*` keys only);
      `src/platform/desktopSecureStore.ts` moves each localStorage secret on first read and
      deletes the plaintext only after the encrypted copy reads back identical. If the keychain
      store exists but can't be opened ("locked"), reads throw instead of returning null, so the
      app never generates a replacement key. Linux without a keyring ("basic_text") keeps
      localStorage as before.
      Hardened after an Argon review (2026-11-04): the file is read strictly (unknown or
      malformed entries are an error, never dropped and overwritten), written with fsync and
      read from disk each time, rename retried on Windows EPERM; a store file that exists but
      can't be checked counts as "locked"; renderer operations are serialized per key so a
      migrating read can't resurrect a replaced or removed value; leftover plaintext from an
      interrupted migration is cleaned up; the preload size-checks values before IPC.
      Declined: treating a locked keychain with no store file yet as "locked" (it would block
      sign-in on machines where safeStorage never works; they keep today's localStorage).
- [x] Signing primitives in `src/lib/deviceTrust.ts`: Ed25519 keys, canonical signed device
      lists (version floor, strict parser), key envelope and message signatures, fingerprints and
      safety numbers, with negative tests in `src/lib/__tests__/deviceTrust.test.ts` (B5, B6, B9).
- [x] Identity key and device signing key generation and storage; publishing device lists
      (`src/lib/deviceIdentity.ts`, server `src/modules/identity`). Runs in the background on
      sign-in; the account's first upgraded device publishes the identity, later devices are
      `pending` until linked (B7). The server keeps every list version, makes the identity
      write-once, and only accepts lists naming the user's own devices, from a device already on
      the current list. Client and server pin one shared wire-format vector.
- [x] TOFU pinning of contacts' identity keys with version floor and same-version equivocation
      check (`getContactDevices`, `acceptContactIdentity`). Not used for sealing until B1.
- [x] New-device and identity-change notices in chats; safety-number screen (B6 UI), 2026-11-11.
      `IdentityNotices` above the composer: a member whose key changed gets a warning (sealing to
      them stays paused) with Review → `SafetyNumberDialog` (60 digits and a QR) → Accept new key;
      a member who added a device gets a dismissible notice. DMs have "Verify security key" in the
      header; a verified mark is kept per pinned identity and dropped when it changes.
- [x] Migration risk: the first device to publish claims the account's identity. Someone who has
      the password (or a recovery code) and signs in before the owner's desktop upgrades would
      claim it, and the owner's desktop would show `pending`/`conflict`. Settings → Devices
      surfaces both, and the owner can take the account back with the B10 reset (password +
      recovery code), which signs the other devices out and warns contacts.
- **M1b design (B1 + B5 + B7 + B8 behind one switch), 2026-11-04:**
  - `ConversationKey` gains `deviceId` (null only on legacy per-user rows), `issuerDeviceId` and
    `signature`; unique on `(conversation, device, keyVersion)`. Writes are create-only (409 on
    an existing row).
  - Every key-writing request (create, add/remove/leave, rotate) carries
    `deviceKeys: [{ deviceId, sealedKey, signature }]` instead of `encryptedKeys` per user. The
    server stamps `issuerDeviceId` from the access token, never from the body, and refuses the
    write unless: the issuer is on its user's current signed list; every recipient device is on
    its member's current list; every listed device of every member gets a row (so a sloppy
    client can't lock someone out); each signature verifies against the issuer's signing key
    from that list. Clients still verify everything themselves; the server checks are a backstop.
  - `GET /keys/:conversationId` returns only rows for the caller's device. A device that isn't on
    its user's list gets 403 there and on send.
  - Linking: after E publishes the list with N, E writes N's rows for every (conversation,
    keyVersion) it holds in one batch (`POST /keys/device-batch`, recipient N only, signed by E).
    The link channel then only carries the identity private key and the new list, not the keys.
  - Sealing to contacts uses `getContactDevices` (pinned, verified lists). `identity-changed`
    pauses sealing for that member until acknowledged (§4 decision 6).
  - Switch: server env `E2EE_PER_DEVICE`; clients read it from `GET /config/e2ee`. Off: legacy
    per-user writes only (today's behaviour). On: per-device writes only, legacy writes rejected.
  - Rollout: once the switch is on, clients older than the per-device release can't create or
    read new keys, so it flips only after the desktop auto-update has reached users; older
    clients then get an "update required" error instead of silently mis-sealing.
  - Leaving a group: the leaver can't issue the next key (it wouldn't be a member, so recipients
    would reject its envelopes). Leave marks the conversation as needing rotation and the next
    remaining member to send rotates first.
- M1b progress:
  - [x] Migration `20261104120000_per_device_conversation_keys`: `device_id`, `issuer_device_id`,
        `signature`; unique per (conversation, device, version); legacy rows keep a partial unique
        index. Legacy `POST /keys` behaves as before while the switch is off.
  - [x] Server envelope verifier `src/modules/keys/key-envelope.ts`, pinned to the client's
        `signKeyEnvelope` by a shared vector (client `deviceTrust.test.ts`, server
        `key-envelope.spec.ts`).
  - [x] `DeviceKeysService` (`src/modules/identity/device-keys.service.ts`): builds rows only
        when every linked device of every member gets exactly one copy, the issuer is linked, and
        every signature verifies; inserts are write-once. 12 attack-case tests in
        `test/integration/device-keys.spec.ts`.
  - [x] Switch: `E2EE_PER_DEVICE` (default off), `GET /config/e2ee`.
  - [x] Server wiring (2026-11-10), all behind the switch:
        - create/add/remove take `keyVersion` + `deviceKeys`; create also takes a client-chosen
          `conversationId` (each envelope signs it, so it must exist before sealing). The client
          names the version; if someone rotated first it gets 409 `key_version_conflict` with
          `expectedKeyVersion` and re-seals.
        - leave flags `conversations.rotation_required` (migration
          `20261110120000_conversation_rotation_required`) instead of rekeying; sends get 409
          `rotation_required` until a remaining member calls `POST /conversations/:id/rotate-key`
          (socket `conversation_key_rotated`; `member_left` carries `rotationRequired`).
        - send (REST and socket) refuses an unlinked device (403 `device_not_linked`) and any
          version but the newest (409 `stale_key_version`); socket errors now carry `code`.
        - `GET /keys/:id` returns only the caller's device rows plus its user's legacy rows
          (`legacy: true`, for the one-time move), with an `issuerUserId` lookup hint; 403 for an
          unlinked device. Legacy `POST /keys` and legacy `encryptedKeys` are refused with
          `update_required`; with the switch off, per-device fields are refused.
        - `POST /keys/device-batch`: a linked device adds signed rows for its own user's linked
          devices only, for versions the user can read that already exist; write-once
          (duplicates skipped, never replaced). Used for linking (B7) and the legacy move.
        - Every rotation path (both modes) takes `SELECT … FOR UPDATE` on the conversation and
          re-reads membership under it, which fixed the add/remove race; the skipped race test in
          `rekey.spec.ts` now runs. 18 attack-case tests in
          `test/integration/per-device-conversations.spec.ts`.
        - From the review (Gemini Flash; Argon's quota was out): leave's "last member, destroy"
          check moved under the lock (it could delete a group someone was just added to); adding
          members to a DM and DMs with more than one other person are refused; `memberIds` must
          be UUIDs, at most 500 per request.
  - [x] Client (2026-11-11): `src/lib/conversationKeys.ts` (recipients from verified lists,
        sealing, verifying and opening envelopes), `src/features/conversations/conversationKeyOps.ts`
        (key writes with 409 re-seal and `device_list_changed` refetch, rotation, `ensureSendableKey`),
        per-device paths in group create/add/remove/leave and DMs, outbox rotation-before-send and
        one automatic re-encrypt after `rotation_required`/`stale_key_version` (re-wrapping
        attachment file keys, never re-sending a refused ciphertext).
        Rules the client enforces, whatever the server returns:
        - an envelope is opened only if it's for this device and its signature verifies against the
          issuer's key from a list verified against a pinned (or held) identity; the envelope
          fields come from local context, not the row;
        - only the newest version, issued by this user or a current member from a device on their
          **current** list, may be used to encrypt; anything else (unsigned, a former device, a
          former member, missing) forces a rotation first. Former devices (`GET
          /identity/:userId/device-lists/:deviceId`, new) and former members can vouch for
          history only, and a non-member is believed only if already pinned, never on first sight;
        - unsigned legacy rows are read only until this device's one-time move (re-sealed to all
          own devices through `device-batch`) completes, and never used to encrypt;
        - once a device has seen per-device keys it never goes back (`orbit:perDeviceKeys:<user>`),
          and the classic interface (legacy keys only) stops being offered;
        - sealing never goes to a partial set: no identity, an unreviewed identity change or an
          unverifiable list aborts the write with the member's name.
        Server additions: `device_list_changed` code; legacy key directory deduplicated
        (`20261111120000_dedupe_user_public_keys`, registration is an upsert).
        Review (Gemini Flash, Argon still out) found and fixed: history keys from non-members were
        believed (and pinned) on first sight; a 409 version jump left the skipped versions
        unfetched (now refetched, plus a throttled refetch whenever a message needs a version this
        device lacks); decrypted messages and pending sends outlived an expired session (now
        cleared on any session end); the cached current key could be downgraded; concurrent first
        calls could create two signing keys.
- [x] Per-device public keys and conversation keys, idempotent key registration, removal of
      duplicate `user_public_keys` rows, migration (B1). Each device's encryption key lives in the
      signed device list; `user_public_keys` stays only as the legacy directory, so it got no
      `deviceId`/`revokedAt`.
- [x] Write-once, signed conversation key envelopes (B5).
- [x] Linking: QR mode and typed mode with CPace; `libsodium-wrappers-sumo` (B7), 2026-11-11.
      - Server relay `src/modules/link` (migration `20261111130000_link_sessions`): one active
        session per account, 2 minutes (a fresh 2 once joined, so publishing the list and
        delivering the welcome can't be cut off in between), single use, 5 per hour, roles
        enforced (only a linked device plays the existing side), `complete` only once the new
        device is on the signed list, attempts listed for Settings. 12 integration tests.
      - `src/lib/cpace.ts`: CPACE-RISTR255-SHA512 per draft-irtf-cfrg-cpace-21, pinned to its
        Appendix B.3 vectors (generator, Ya, Yb, K, ISK, invalid points).
      - `src/lib/deviceLinking.ts`: QR payload, 8-character Crockford codes, an AEAD channel bound
        to session/direction/step, hello (with proof of the signing key), 6-digit confirmation code
        from the hello, welcome (identity key + signed list, signed by the linking device and
        checked against the QR fingerprint when there is one). 15 attack-case tests.
      - `src/features/devices/linkDevice.ts`: the four flows (either side shows the code, QR or
        typed); history shared afterwards through `device-batch` and resumed on the next sign-in
        if interrupted (`shareHistory.ts`); the newest key is withheld when the linking device
        wouldn't send with it. UI: `LinkDeviceDialog` from Settings → Devices.
- [x] Revoke with list update, token revocation and key rotation (B8), 2026-11-11. Publishing a
      list without a device is the revoke: the server signs it out, deletes its key copies, flags
      every chat of the user `rotation_required` and closes its open sockets (`SessionEvents` →
      gateway). The revoking device also rotates its chats at once. Contacts that see a list
      shrink flag shared chats themselves (backstop for a server that skips the flag). "Forget
      this device" wipes its keys; the only linked device can't remove itself. Unlinked
      sign-ins can be signed out from a linked device (`POST /identity/me/devices/:id/sign-out`).
- [x] Message and attachment signatures with legacy handling (B9), 2026-11-11. The client picks
      the message ID and signs `orbit/message/v1 ‖ conversationId ‖ keyVersion ‖ messageId ‖ nonce
      ‖ ciphertext` (attachments are covered: their manifest and hashes are inside the ciphertext).
      Server (migration `20261111140000_message_signatures`): stores `sender_device_id` (from the
      token) and `signature`; with per-device keys unsigned sends get `update_required` and the
      signature is checked as a backstop; a resend with the same ID returns the stored message.
      Shared wire vector in both repos. Receivers (`messageSigners.ts`): verified (current list),
      sent from a removed device, invalid (shown as "Unverified sender"), or legacy (no notice).
- [x] Identity reset flow (B10), no key backup (§4 decision 5), 2026-11-11. `POST
      /identity/me/reset` needs the password (checked first, so a wrong one doesn't spend a code)
      and a recovery code, under the sign-in lockout; the new list names only the resetting device;
      every other device is signed out and loses its key copies; every chat is flagged for a new
      key. Contacts see the identity change and nothing is sealed to the user until they accept it.
      UI: Settings → Devices → "Lost all your other devices? Reset your security key".
- [x] CORS: `capacitor://localhost` (iOS) and `https://localhost` (Android) always allowed
      (`src/config/cors.ts`), next to `CORS_ORIGIN` for web builds.
- [x] Hardening found along the way (server):
  - startup refuses missing, short (< 32), placeholder or shared JWT secrets (`src/config/env.validation.ts`);
    no `'fallback-secret'`; HS256 pinned;
  - access tokens and socket handshakes are rejected once their device's session is revoked
    (`src/modules/auth/device-session.ts`), not 15 minutes later;
  - recovery codes: shared lockout with password sign-in (also on the chat-passcode bypass),
    one code can't be spent twice by racing requests, input normalized, new codes are 64-bit;
  - chat passcodes: 5 wrong guesses per user per chat per 15 minutes (`passcode_attempts`);
  - `scripts/migrate.mjs` no longer runs `taskkill /im node.exe` (would kill every Node service on
    PGX) or marks failed/unapplied migrations as applied.
- [x] B8 follow-up: a revoked device's already open sockets are closed on revoke, and a removed
      or departed member's sockets leave the conversation room at once.
- [x] Sign-out ends the session on the server too (`POST /auth/logout`): the device's refresh
      token is revoked, its sockets are closed and its push registration is dropped. The client
      also clears every per-user store on sign-out, so the next account on the device starts
      clean. Server-side events go through one in-process bus (`src/modules/auth/session-events.ts`:
      devices signed out, keys added, message sent).
- [ ] PGX: the database has no `_prisma_migrations` table (schema came from `db push`, so every
      start hits P3005 and falls back to `db push`). Baseline it with `prisma migrate resolve
      --applied` for each migration once `migrate diff` is empty (it was on 2026-10-23), then drop
      the `db push` fallback from `src/main.ts`.
- [ ] PGX: MinIO runs with the default `minioadmin` credentials and ports 9000/9001 are open to the
      internet. Rotate the credentials and close the console port before starting MinIO again.
- [x] Integration tests run locally without Docker: `embedded-postgres` on port 5433 with
      `DATABASE_URL_TEST=postgresql://orbit:…@127.0.0.1:5433/orbit_test` (throwaway, outside the
      repo). Fixed `membership.spec.ts` "rate-limits recovery-code guesses on the passcode
      bypass", which never seeded a recovery code and so never reached the lockout.
- [ ] Integration tests in `orbit-server/test` and crypto tests in `src/lib/__tests__`. The
      attack cases matter more than the happy paths:
  - a key the server adds outside a signed device list receives no conversation keys;
  - a device list with a bad signature, or a lower version than one already seen, is rejected;
  - a `pending` device can't fetch keys or send;
  - an unsigned or wrongly signed key envelope or message is rejected;
  - overwriting an existing `ConversationKey` row fails;
  - a revoked device can't read anything sent after the revoke;
  - a linking secret or session used twice is rejected; an expired session is rejected;
  - a wrong typed code fails key confirmation and kills the session after one attempt;
  - CPace matches the draft's test vectors;
  - password or recovery-code sign-in alone yields no history.

### M2 — Responsive design ✅ done (2026-11-11; not yet tried on a real phone)
The UI assumes a ≥980 px window (rail | sidebar | chat). Phones need a single-pane stack.
- [x] Breakpoint layout in `AppShell`: below 768 px (`useCompactLayout`, `src/ui/useMediaQuery.ts`)
      one pane at a time, driven by the route (list → chat → thread/settings) with a back button
      in `ChatHeader`; the rail becomes `BottomTabBar`; the thread panel is a full-screen overlay.
- [x] Touch: the hover toolbar is hidden on touch screens (`hover: none`), and a long press on a
      message opens its menu (Radix, after 700 ms of a still touch) with the same actions: quick
      reactions, reply, thread, pin, copy, and edit/delete on your own messages. Message rows turn
      off text selection and the iOS callout on coarse pointers so the long press isn't swallowed.
      Buttons are at least 44 px on coarse pointers (`src/ui/Button.tsx`).
- [x] Safe areas (`env(safe-area-inset-*)`), `viewport-fit=cover`, `100dvh`; the web view resizes
      for the keyboard through `@capacitor/keyboard` (`resize: native`). iOS WebKit already scrolls
      `MessageList` with momentum.
- [x] Dialogs become bottom sheets below 768 px (`src/ui/Dialog.tsx`; Radix unchanged).
- [x] Desktop-only UI hidden on phones: phones never get the classic UI (`src/main.tsx`), the
      updater section stays behind `isDesktop`, chat pins are hidden in the compact header.
- [x] Linking screens: `LinkDeviceDialog` (QR + typed code, countdown, confirmation code) and
      `PendingDeviceBanner` (scan or type, plus "Lost all your other devices?" leading to B10).
- [x] Main screens checked in the browser at 375×812 and 412×915. Still to do on real phones
      (the device checklist in `AGENTS.md`).

### M3 — Capacitor shells ✅ done (2026-11-11; native builds not compiled on this machine)
- [x] Capacitor 8.5.3 (`@capacitor/core`, `@capacitor/cli`), `ios/` (Swift Package Manager),
      `android/`, `capacitor.config.ts` (`webDir: dist`, no `server.url`, `androidScheme: https`).
- [x] `npm run build:mobile` (`vite build --mode mobile`) without the Electron plugin; the app
      refuses to talk to a non-HTTPS server (`insecureServerProblem`).
- [x] Mobile `Platform` (`src/platform/capacitor.ts`): secure store from the local plugin
      `native/secure-store` (Android Keystore AES-GCM, StrongBox when present; iOS Keychain
      `AfterFirstUnlockThisDeviceOnly` in the shared access group, B4), camera QR scanner,
      `deviceName` "Orbit iOS"/"Orbit Android".
- [x] Strict CSP injected into `index.html` by the mobile build (`mobileCsp` in `vite.config.ts`):
      self, the API/socket/media origins, `api.giphy.com`/`media.giphy.com`, `blob:`/`data:` images.
- [x] Android: privacy screen (`FLAG_SECURE`), `allowBackup=false` plus data-extraction rules,
      cleartext off (network security config), R8 with keep rules in release. iOS: privacy screen
      in the app switcher, ATS on, no `NSAllowsArbitraryLoads`.
- [x] The refresh token is kept in the secure store (`orbit:session`), so phones stay signed in;
      desktop still signs in every launch.
- [ ] Compile both apps. This machine has no JDK 21 (Android) and no macOS (iOS), so the native
      code, including `SecureStorePlugin.swift`, has not been built yet; `.github/workflows/mobile.yml`
      does it on every PR.

### M4 — Push notifications ✅ server and client done (2026-11-11; needs push credentials)
Sockets don't survive in the background on mobile, so push is required for message delivery alerts.
- [x] Server (`src/modules/push`): one APNs/FCM token per signed-in device (`push_registrations`);
      on every new message a **content-free** push ("New message": no sender, no text, no
      conversation title) to the other members' devices. APNs over HTTP/2 with an ES256 token,
      FCM v1 with a service-account token; dead tokens are dropped. Sign-out and device removal
      delete the device's registration.
- [x] Client: `usePushRegistration` registers after sign-in and again whenever the settings change.
- [x] Respects notification prefs and per-chat mute: push is on only in "all" mode (the server
      can't read messages, so it can't honour "mentions only"); muted chat IDs go with the
      registration and the server skips them.
- [ ] Credentials: an APNs key (`APNS_*`) and an FCM service account (`FCM_*`) on the server
      (`.env.example`), and `google-services.json` in `android/app/` (git-ignored). Without them
      the server skips every push.
- [ ] Optional later: encrypted previews decrypted on-device (iOS Notification Service Extension
      reading the key from the shared Keychain access group set up in B4, and an Android service
      reading from the Keystore).

### M5 — Mobile security features ✅ done (2026-11-11)
- [x] App lock with Face ID / Touch ID / fingerprint (`src/features/security/appLock.tsx`,
      Settings → Privacy → This phone): it can only be turned on after a successful check, and it
      covers the app at launch and every time the app comes back from the background.
- [x] Chat passcode locks: `on_leave` chats lock when the app goes to the background
      (`useLockChatsInBackground`).
- [x] Jailbreak/root detection is advisory only (`deviceIntegrity` in the secure-store plugin):
      a warning in Settings, nothing is blocked.

### M6 — Release pipeline
- [x] CI builds: `.github/workflows/mobile.yml` builds the renderer, syncs it and compiles Android
      (Gradle, JDK 21, debug) and iOS (macOS runner, simulator, unsigned) on every PR. Not yet run
      on GitHub.
- [x] Signed store builds: `.github/workflows/mobile-release.yml` (tag `mobile-v*.*.*`, or run by
      hand) builds a signed Android App Bundle and uploads an iOS build to TestFlight. Signing
      material comes only from repository secrets, lives in the runner's temp directory and is
      removed afterwards; `android/app/build.gradle` signs only when `ANDROID_KEYSTORE_PATH` is
      set; `.gitignore` blocks keystores, certificates, profiles and push service files.
- [ ] Blocked on accounts: an Apple Developer account and a Google Play Console account, the
      upload keystore and distribution certificate as repository secrets, then the TestFlight and
      Play internal tracks, store listings, privacy labels / data safety form (no plaintext
      collected, metadata disclosed honestly). Play needs the first bundle uploaded by hand.
- [x] Manual smoke checklist in `AGENTS.md` extended to mobile: linking by QR and by typed code,
      cancelling a link, signed messages and safety numbers, removing a device, and phone-only
      checks (app switcher, app lock, content-free push).

### Before turning `E2EE_PER_DEVICE` on
- [ ] Deploy the server first (four new migrations: `dedupe_user_public_keys`, `link_sessions`,
      `message_signatures`, `push_registrations`), then the desktop client, then the phone apps.
- [ ] Pick the production hostname and TLS (decision 2 below); phone builds refuse plain HTTP.
- [ ] Run the `AGENTS.md` device checklist on two real devices against a staging server with the
      switch on.
- [ ] Minor: after a device is removed, the removing device rotates the chat key and each
      contact's removal backstop may rotate it once more (seen locally: v2, then v3). Harmless,
      but the backstop could skip when a key newer than the device-list change already exists.

## 4. Decisions

Decided:
- New-device history comes from linking with an existing device, by QR (camera) or typed code
  (CPace). Sign-in alone never grants history. (B7)
- 2026-11-04, accepted as recommended:
  1. **Capacitor** (not React Native).
  3. Push is **content-free only** for v1; encrypted previews later.
  4. Bundle ID **`com.orbit.chat`** on both stores (accounts still to be set up before M4/M6).
  5. Losing every device: **reset identity only** for v1, no key backup (B10).
  6. Contact identity change: **warn and pause sealing** until acknowledged (B6).
- Delivery order: M0 remainder → M1 (device status, Devices list, `safeStorage`; then
  B1/B5/B6/B7/B8 together behind one switch; then B9, B10, CORS) → M2 → M3 → M4 → M5 → M6.
  M2 can run alongside M1. Gemini Argon (`gemini-argon` skill) builds bulk UI work and reviews
  M1 diffs; crypto and protocol code stay with Claude.

Open:
2. Production hostname for TLS (B3). Blocks on-device testing, not the protocol work.

Constraints:
- iOS builds need macOS + Xcode (or a macOS CI runner); this Windows machine can build Android only.
