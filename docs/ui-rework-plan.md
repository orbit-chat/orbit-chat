# Orbit Chat — Client UI Rework Plan

Status: draft, 2026-10-18. Baseline: `orbit-chat` `main` @ `0d71183` (v0.9.3).

## Goal

Rebuild the renderer UI from scratch, piece by piece, so it is fast, smooth, good looking and
feature complete. Keep the concept, the layout idea (nav rail → sidebar → main pane) and the
palette (dark navy panels, teal `#2dd4bf` accent, rose `#fb7185` danger). Throw away the UI code.

**Not being rewritten:** `src/lib/crypto.ts` (and its test suite), `src/lib/api.ts`, the
E2EE / auth / socket / chat-lock stores, `electron/`. The new UI is built on top of these. They
only change where the UI needs a cleaner interface.

## Why start fresh instead of patching

The current UI is one component: `App()` in `src/App.tsx` runs from line 598 to 5851. It has
**82 `useState`, 52 `useEffect`, 20 `useRef`**, 14 socket handlers, 32 API calls and 9 direct
`localStorage` calls. Each bug comes from the structure, not from one bad line, so fixing one
just moves it somewhere else.

### Root causes behind the reported bugs

| Symptom | Root cause (file:line) | Bug class |
|---|---|---|
| Settings must be closed with **Close**; clicking a nav item doesn't leave it | Page shown is decided by two separate states: `mainView` (`App.tsx:604`) and `navTab` (`:605`). The nav rail click handler (`:3518`) sets `navTab` and never resets `mainView`. The render ternary (`:4005`) checks `mainView === "profile-settings"` first, so settings wins. | Navigation state split across flags |
| Hovering the pinned/search popover shows reaction toolbars on the messages underneath | The conversation header has `backdrop-blur` (`:4187`). `backdrop-filter` creates a new stacking context **and** becomes the containing block for `position: fixed` children. So the popover's `z-30` and its "click-outside" backdrop `fixed inset-0 z-20` (`:4255`) are both trapped inside the header. The backdrop only covers the header, not the screen. The message `<article>`s are `relative` and come later in the DOM, so they paint *above* the popover and get its hover events. | Overlays rendered in place instead of in a top layer |
| (same family) Chat settings modal lets clicks through to the app behind it | Its overlay is `orbit-modal-overlay pointer-events-none` (`:4978`) | Hand-made modals |
| (same family) Escape / outside-click behave inconsistently | 6+ separate `window` `keydown`/`pointerdown` listeners (`:958`, `:1703`, `:1728`, `:1791`, `ContextMenu.tsx:56-59`, `UserProfilePopover.tsx:96-97`), each closing its own popup with no shared stack | No overlay manager |
| Hover toolbar flickers / feels laggy | Hover is React state (`hoveredMessageId`, `:626`) set on every `mouseenter`. That re-renders the whole 5k-line `App` and every message. | Hover handled in JS instead of CSS |
| Typing feels heavy in big chats | `messageDraft` lives in `App`, so each keystroke re-renders the whole tree including every message | No component boundaries |
| Long chats get slower and slower | No virtualization. Every message runs `messages.filter(...)` for its reply count and `.includes()` for pinned state (`:4402-4406`), which is O(n²) per render. | No derived indexes, no windowing |

Other things found along the way:

- `@tanstack/react-query` is installed and its provider is mounted (`main.tsx`), but nothing
  uses it. `react-hook-form` and `zod` are installed and unused.
- 11 distinct hard-coded hex colours in TSX on top of the Tailwind `orbit.*` tokens.
- Archive/pinned-chat/chat-preference state is written straight to `localStorage` from
  `App`, with no per-user key (another account on the same machine sees it).

## Architecture rules for the new UI

Each rule removes a whole bug class from the table above.

1. **One route, one source of truth.** A `navigationStore` holds a discriminated union:
   `{ page: "home" } | { page: "dm", conversationId? } | { page: "groups", conversationId? } |
   { page: "friends" } | { page: "archive" } | { page: "settings", section }`. Settings is
   a page like any other, so going anywhere else leaves it. A small history stack gives Back /
   Forward (mouse buttons, `Alt+←/→`) for free.
2. **Every floating thing goes through one overlay system.** Popovers, menus, context menus,
   tooltips, pickers, hover cards and dialogs all render through a portal into a top-level
   layer. Use **Radix UI primitives** (unstyled, works with Tailwind). They come with focus
   trapping, a shared Escape/dismiss stack, outside-click handling, scroll lock, collision-aware
   positioning and ARIA. Nothing hand-rolls `fixed inset-0` again. While a modal is open the app
   behind it gets `inert`.
3. **Hover and focus are CSS.** Message toolbars show on `:hover` / `:focus-within` (Tailwind
   `group-hover`, `group-focus-within`). No React state per mouse move. Because overlays sit on
   top in their own layer, the browser's hit-testing stops hover from leaking through.
4. **Small components that own their state.** Composer state stays in the composer, picker
   state in the picker, modal form state in the modal. `App.tsx` becomes a shell under ~150
   lines.
5. **Server state in react-query, live updates pushed into its cache.** Conversations,
   friends, requests and profiles become queries. Socket events update the cache. Messages
   stay in `messagesStore` (they're decrypted client-side and stream in) with indexes built
   on write: `byId`, `replyCountByParent`, `pinnedSet`.
6. **Virtualized message list** (`@tanstack/react-virtual`): variable heights, kept pinned to
   the bottom, jump-to-message, scroll position kept per conversation.
7. **Design tokens as CSS variables** (`--orbit-bg`, `--orbit-panel`, `--orbit-accent`, …) that
   Tailwind reads. No raw hex in components. Same palette, applied consistently.
8. **Per-user persistence.** A single `prefsStore` (zustand `persist`) keyed by user id holds
   archive, pinned chats, realtime prefs, recent emojis and the last route.
9. **Tests for the bugs, not just the crypto.** Add Testing Library + jsdom component tests.
   Every bug in the table gets a regression test as its feature lands.

### Proposed layout

```
src/
  app/            App shell, providers, router outlet, title bar, update banner
  ui/             Design-system primitives: Button, Input, Dialog, Popover, Menu, Tooltip,
                  Avatar, Badge, ScrollArea, Kbd — thin Radix + Tailwind wrappers
  features/
    auth/         Login, signup, recovery login, recovery-codes screen
    navigation/   navigationStore, NavRail, keyboard shortcuts
    conversations/ Sidebar, ConversationList, ConversationItem, context menu, archive/pin
    chat/         ChatView, ChatHeader, MessageList (virtual), Message, MessageToolbar,
                  Reactions, PinnedPopover, SearchPopover, ThreadPanel, TypingIndicator
    composer/     Composer, AttachmentTray, GifPicker, EmojiPicker, MentionMenu, ReplyBar
    chat-settings/ ChatSettingsDialog, PasscodeLockScreen, DeleteOrLeaveDialog
    groups/       CreateGroupDialog, AddMembersDialog
    friends/      FriendsPage, requests, search
    profile/      ProfilePopover, settings sections (Profile, Privacy, Keybinds, Updates, About)
  stores/         existing stores + navigationStore + prefsStore
  lib/            unchanged (api, crypto, devLogger)
```

## Migration strategy

Build the new UI **next to** the old one, not inside it. `main.tsx` mounts the new shell when
`VITE_NEW_UI=1` (or a dev-only toggle) is set, otherwise the old `App`. Both share the same
stores and lib, so either can be run at any time and compared. When the parity checklist is
all ticked, delete `App.tsx`, `ProfileSettings.tsx`, `UserProfilePopover.tsx` and
`ContextMenu.tsx` in one commit and drop the flag.

Work on one long-lived branch, one PR per phase into it. Each phase must pass `npm run check`
and be tried in the running app before the next one starts.

## Phases

Each phase can be shipped and tested on its own. Later phases depend on earlier ones.

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | Foundations | Folder layout, CSS-variable tokens, Radix-based `ui/` primitives, `navigationStore`, `prefsStore` (with migration from current `localStorage` keys), new-UI flag, Testing Library setup | Primitives render in a dev gallery; `npm run check` green |
| 1 | Shell + auth | Title bar (frameless controls), nav rail, sidebar + main outlet, auth gate, login / signup / recovery / recovery-codes screens, update banner | You can sign in and move between empty pages; settings closes on any nav (test) |
| 2 | Conversations | Home/DM/Groups/Archive lists, unread badges, pin/archive, conversation context menu, user search, start DM | Lists match old UI; context menu works with keyboard |
| 3 | Chat view (read) | Header, virtualized message list, decrypted bodies, media attachments, day separators, key-version notices, jump-to-bottom | Smooth scroll in a 5k-message chat; stays at bottom on new messages |
| 4 | Composer | Draft, send, attachments, GIF picker, emoji picker, @mentions, reply bar, keyboard shortcuts | Typing doesn't re-render the list (profiler check) |
| 5 | Message interactions | CSS hover toolbar, reactions (quick + full picker), message context menu, pinned popover, search popover, thread panel, read receipts, typing indicators | Hovering popovers never triggers toolbars underneath (test) |
| 6 | Chat settings + locks | Chat settings dialog, passcode lock/unlock + bypass recovery, new-chat passcode reveal, delete/leave dialog, create group, add members | Every dialog traps focus, closes on Escape, blocks clicks behind it |
| 7 | Friends + profile | Friends page (requests in/out, remove), profile popover/hover card, settings as a routed page with sections | Settings is reachable from the nav and closes when you leave it |
| 8 | Polish + cutover | Motion/transitions, empty states, notifications, dev overlay, a11y pass, parity checklist, delete old UI, release | Parity checklist all ticked; old files removed |

## Feature parity checklist (from the current client)

Auth: login · signup with confirm · recovery-code login · one-time recovery codes screen ·
sign out · silent token refresh.
Shell: frameless title bar · updater banner/status · build badge · realtime connection badge.
Navigation: Home · DMs · Groups · Friends · Archive · unread-DM dot.
Conversations: list with last activity · pin chat · archive/unarchive · context menu · user
search → start DM · create group · add members · delete+unfriend / leave group (wipe option).
Messages: E2EE decrypt with key versions · attachments (encrypted media) · GIF links ·
reactions + shortcode picker · quick reply · reply/thread panel · pin/unpin · in-chat search
with jump · ping highlighting · @mention autocomplete · ping author · read receipts ·
typing indicators · copy/context menu.
Composer keybinds: `Ctrl/Cmd+I` attach · `+G` GIF · `+E` emoji · `+/` focus · `Enter` send.
Chat settings: rename · passcode change/length · lock mode + timeout · read-receipt and
typing toggles · lock screen with recovery bypass · new-chat passcode reveal.
Friends: accept/decline/cancel requests · remove friend · friend counts.
Profile: popover · display name, bio, status + emoji, links, avatar/banner · privacy
(delete messages on unfriend) · keybinds reference · manual update check / macOS releases link.
Dev: dev overlay + logger.

## Decisions

1. **Overlay library:** Radix UI primitives (unified `radix-ui` package).
2. **Tailwind:** stays on v3.4 for now. Both UIs share one Tailwind build during the
   side-by-side period, and v4 would break the old UI's styles. Revisit at cutover (Phase 8).
3. **Branch:** `v.1.0` off `main`.
4. **Cutover:** feature flag side by side.

## Running the new UI

| Command | What it does |
|---|---|
| `npm run dev` | Old UI in Electron (unchanged default) |
| `npm run dev:new` | New UI in Electron (`.env.newui` sets `VITE_NEW_UI=1`) |
| `npm run dev:new:web` | New UI in a browser at `localhost:5173`, no Electron (`*-web` modes skip the Electron plugin; `window.electronAPI` is undefined) |

Production builds never include `src/app` unless `VITE_NEW_UI=1` is set at build time.

## Progress

### Phase 0: done (2026-10-18)

- Tokens: `src/styles.css` `:root` CSS variables; `tailwind.config.ts` reads them. The original
  `orbit-*` names keep their values; added a surface scale (`chrome` → `hover`), `accentBright`,
  `warning`, a `z-*` scale for floating layers (`popover` 50, `dialog` 60, `menu` 70, `toast` 80,
  `tooltip` 90), and enter/exit animations.
- `src/ui/`: `Button`/`IconButton`, `Input`/`Textarea`/`Field`, `Dialog`, `Popover`,
  dropdown + context `Menu`, `Tooltip`, `Avatar` (with presence), `Badge`/`CountBadge`/`Kbd`,
  `icons`, `cn`.
- `src/stores/navigationStore.ts`: route union, history (back/forward), per-tab
  last-conversation memory, `forgetConversation`.
- `src/stores/prefsStore.ts`: per-user persisted prefs (archive, pinned chats, realtime
  prefs, recent emojis). Imports the old shared keys once, for the first account only; never
  writes or deletes them.
- `src/app/`: `NewApp` root, `TitleBar`, `dev/DevGallery` (all primitives, plus live
  reproductions of both reported bugs).
- Tests (jsdom + Testing Library): navigation store, prefs store, overlay portal/dismiss/focus
  behaviour, and a rail test confirming settings closes on navigation.
- Checked by hand in the browser: the popover covers the message rows and every point over it
  hits the popover (no toolbar underneath); hovering a message shows only that toolbar;
  Settings → Friends replaces the settings page.

### Phase 1: done (2026-10-18)

- `app/NewApp` gate: auth screen → one-time recovery codes → `AppShell`. The dev gallery moved
  to `#gallery` (dev builds only).
- `features/auth`: `AuthScreen` (Sign in / Create account / Recovery tabs, react-hook-form +
  zod, live password checklist, show/hide + Caps Lock warning, username kept across tabs),
  `RecoveryCodesScreen` (copy, save as .txt, must confirm before continuing), `signOut()` which
  resets auth, chat locks, prefs, navigation and the query cache in one place.
- `app/AppShell`: rail | sidebar | main, all driven by the route; settings takes over both
  columns. `NavRail` with tooltips, active marker and an `AccountMenu` (avatar with presence,
  edit profile, settings, sign out, version).
- `features/settings/SettingsPage`: routed sections. Keybinds, Updates (manual check,
  install/download) and About (version, platform, server) are real; Profile and Privacy wait
  for Phase 7. Escape or the close button returns to the previous page; Escape that closes a
  menu first doesn't also close settings.
- Navigation shortcuts: `Alt+←/→`, mouse back/forward buttons, `Ctrl/Cmd+,`.
- `UpdateBanner` (dismissible, per-platform install action) and `ConnectionBanner`, which
  replaces the always-on "Realtime connected" badge and only appears after 2.5s of being
  offline, with a Retry button.
- `useSessionLifecycle`: socket follows the token, prefs activate per user, own profile loads.
- Sora is now bundled (`@fontsource-variable/sora`) and loaded only by the new UI.
- Small shared changes: `authStore.clearError()`, `api.API_BASE` exported,
  `window.electronAPI` typed as optional (it's undefined in a browser).
- Tests: auth schemas (including parity with the old password regex), auth screen flows,
  recovery-codes gate, shell navigation and settings regression, shortcuts, sign-out reset,
  update banner.
- Checked by hand in the browser (no server; a fake signed-in user was injected with no token):
  validation, password checklist, tabs, rail → settings → friends, Escape behaviour, account
  menu, sign out.

Not verified yet: real sign-in/sign-up against a server, the socket banner against a live
connection, and the Electron window (Electron couldn't download its binary in the sandbox).
Session persistence is unchanged from the old app: tokens live in memory, so restarting the
app signs you out.

### Phase 2: done (2026-10-18)

- `features/conversations/conversationsStore`: the conversation list, load status and
  pending one-time passcodes. **Deviation from rule 5:** conversations live in Zustand, not
  react-query, because socket handlers and non-React code (sign-out, DM creation) mutate
  them directly. Friends do use react-query (`features/friends/friendsQueries`).
- `selectors.ts` (pure, tested): titles (custom name → DM partner's display name → group
  members "Ada, Grace +2"; the old `username#1a2b` suffix is gone), pinned-then-recent
  ordering, filter matching, compact list times, previews that name the sender without
  decrypting (DMs just say "Sent a message").
- `useConversationSync` (mounted in `AppShell`): initial load, reload after reconnect,
  history backfill (3 at a time), profile loading for avatars, and the socket events
  `conversation_created`, `chat_settings_updated`, `passcode_reenabled`,
  `conversation_deleted`, `member_removed`, `member_left`, `member_added`,
  `presence_updated`, `new_message`. A removed conversation is dropped from the list, the
  route/history and prefs together. Route effects: opening a chat marks it read, leaving it
  calls chat-lock `onLeave`, and its key is fetched.
- **Fix vs old UI:** backfilled history was counted as unread after storage loss; it's now
  marked read.
- `startDirectMessage`: moved out of `App`, throws readable errors (the old one swallowed
  them, e.g. when the other user has no device keys), and unarchives the DM it opens.
- Sidebar UI: `ConversationSidebar` (header with New message, filter box with Escape to clear,
  Pinned/Recent sections, loading skeleton, error with retry, empty states, arrow/Home/End
  keys), `ConversationItem` (memoised; subscribes only to its own messages, so a new message
  re-renders one row), `ConversationAvatar` (presence for DMs, stacked members for groups),
  right-click menu plus a matching hover "…" menu (Mark as read, Lock chat, Pin/Unpin,
  Archive/Unarchive), and `NewMessageDialog` (friends list, debounced user search,
  Message / Add friend / Accept / Cancel request).
- Rail unread dots on DMs and Groups. `messagesStore.markRead` added.
- Tests: selectors, store (including a stale load after sign-out), DM creation (checks
  both sealed keys open to the same secret), sidebar interactions, sync events.
- Checked by hand in the browser with injected sample data (no token, no server):
  ordering, unread, badges, opening a chat, pin via right-click, New message dialog.

Moved to Phase 6: Delete chat / Leave group in the conversation menu (they need the
confirm dialog and group rekeying). Showing a pending passcode when a chat is opened also
lands with the passcode flows in Phase 6 (the data is already captured).

### Phase 3: done (2026-10-19)

- `features/chat/envelope.ts`: envelope types moved out of `App`, a stricter parser
  (malformed attachments from another client are dropped, not trusted), `searchableText`,
  `safeHttpsUrl`.
- `decryptedStore`: **one decryption per message**, shared by every view (the old UI
  decrypted each body in its component and again for search). Plaintext is memory-only,
  never persisted, and is wiped on sign-out; a failed decrypt is retried when a new key arrives.
- `historyStore`: newest page on open, plus **older history when you scroll up** using the
  server's cursor (the old client only ever showed the latest 50 plus whatever was cached).
- `useOpenConversation`: fetches on open, joins the socket room, rejoins and refetches after a
  reconnect.
- `timeline.ts` (pure): day separators (Today / Yesterday / weekday / date), sender grouping
  within 5 minutes, and the "New messages" marker placed from the unread count captured
  when the chat opened.
- UI: `ChatView` (keyed by conversation, so switching chats starts clean), `ChatHeader`
  (no backdrop-blur; encryption state with an explanation), `MessageList` (react-virtual with
  measured rows: opens at the unread marker or bottom, follows new messages only when you're
  at the bottom or sent them, "Jump to latest" / "N new messages" pill otherwise, keeps your
  place when older pages load, jump-to-message with highlight), `MessageRow` (memoised,
  grouped bubbles, reply quote that jumps to the original, read-only reactions, pinned marker,
  mention highlight, unreadable-key-version notice), `MessageText` (https links only, @mentions,
  line breaks kept), encrypted image/file attachments with integrity check, GIF links.
- Locked chats show a locked panel and fetch nothing (the unlock form comes in Phase 6). The
  composer is a placeholder until Phase 4.
- Tests: envelope parsing and crypto round trip, text tokenizing, timeline, decrypted cache
  (dedupe, retry, reset), history paging, and the rendered chat view (decryption, links,
  markers, mention highlight, reply jump, undecryptable and no-key states, locked chat).
- Checked by hand in the browser with 300 real encrypted messages (no server): 18 of 300
  rows mounted, opens at the bottom, scroll position kept when a message arrives while
  scrolled up, "1 new message" pill. Smooth-scroll animations couldn't be watched there
  (the hidden pane produces no animation frames).

### Phase 4: done (2026-10-19)

- `features/composer/outboxStore`: **sending states the old client never had.** The server
  has no send acknowledgement (it just echoes `new_message`), so a sent message shows at once
  as "Encrypting…/Uploading…/Sending…", is confirmed when the echo carries the same
  ciphertext (its plaintext is handed to the decrypted cache, so there's no flash), and
  becomes "failed" after 20s, on a server `error` event, offline, without a key, or when the
  session/conversation is gone. Retry re-sends the identical ciphertext (or redoes uploads
  that failed); Discard drops it.
- `encryptAttachment`: per-file random key, chunked encryption, integrity hash, upload of
  ciphertext only, file key wrapped with the conversation key. **Change vs old UI:** any
  non-video file up to 50 MB can be attached (the server already allowed it; the old client
  only allowed images).
- `draftsStore`: per-conversation drafts (text, reply target, files with image previews,
  GIF) kept in memory, so switching chats keeps what you were writing; previews are
  revoked when removed or sent.
- `Composer`: auto-growing textarea (Enter sends, Shift+Enter new line, IME-safe), @mention
  combobox (keyboard: arrows, Enter, Tab; matches username and display-name words), reply bar
  (Esc cancels), attachment tray, paste and drag-and-drop of files, GIF picker (Giphy, labelled
  as not end-to-end encrypted) and emoji picker (search, arrow keys, recents) as portalled
  popovers, shortcuts Ctrl/Cmd + I / G / E / "/".
- `useTypingSignals`: one `typing_start`, `typing_stop` after 3s idle, on send, on clearing
  the box, or on leaving; honours the per-chat typing-indicator preference. (Showing other
  people's typing comes in Phase 5.)
- `ErrorBoundary` around the app screens: a render error now shows a recovery screen
  (Try again / Reload) instead of a blank window. Avatars are now `aria-hidden` (names are
  always shown or labelled next to them).
- Tests: mention parsing and ranking, file rejection, outbox (encryption, echo confirmation,
  timeout, retry with identical ciphertext, error attribution, offline/no-key/signed-out),
  attachment encryption round trip, composer interactions, typing signals, error boundary.
- Checked by hand in the browser with network calls stubbed in the page and a fake socket:
  mention completion, typing start/stop, send → "Sending…" → confirmed by echo, server
  error → Retry re-sends the same ciphertext. Real uploads and Giphy weren't exercised.

### Phase 5: done (2026-10-19)

- **Bug 2 is fixed and pinned by tests.** The hover toolbar is CSS only (`group-hover` /
  `focus-within`, kept visible while its own menu is open via `has-[[data-state=open]]`);
  no React hover state remains. The pinned and search popovers are portalled. Checked in a
  real browser: with the mouse over the pinned popover, 260/260 sample points over message
  rows hit the popover, no row is `:hover`, no toolbar shows; hovering a row directly shows
  only that row's toolbar.
- `socketActions`: every interaction emit goes through one helper that records the last
  emit. The server reports all failures on one `error` event, so the outbox now only blames
  a pending send when a send was the last emit (a reaction or pin error no longer fails your
  message).
- Message actions (`messageActions.tsx`), shared by the hover toolbar's "…" menu and the
  right-click menu: Reply, Open thread, Mention, Pin/Unpin, Copy text. Quick reactions in the
  toolbar and context menu, a full reaction picker (only the 15 emoji the server accepts),
  reaction chips you can click to toggle with a tooltip of who reacted.
- `PinnedPopover` (pins among loaded messages, jump, unpin; the server has no list-pins
  endpoint) and `SearchPopover` (Ctrl/Cmd+F; decrypts loaded messages once and searches them
  locally with highlighted excerpts; "load older to search further"). Both jump via
  `chatUiStore.jumpTo`.
- `ThreadPanel`: root + replies beside the timeline with its own composer and draft
  (`conversationId#rootId`); sends default to the thread root. "N replies" links on roots.
  The composer gained `threadRootId` (only the main composer owns the global shortcuts).
- `presenceStore` + `useRealtimeSync`: typing (with 6s expiry, cleared when that person's
  message arrives, honouring the per-chat preference) and live read receipts.
  `TypingIndicator` is a fixed-height line, so it never shifts the layout. "Seen by …" under
  your latest message.
- **Fix vs old UI:** read receipts. The old client emitted `message_seen` for every message
  in the chat on each open; now one receipt goes out for the newest message from someone
  else, only while the window is visible, once per message, and not at all if receipts are
  off for the chat.
- Fixed while testing: the "Mention" action used a stale snapshot of the draft and could
  overwrite text typed since the menu was built.
- Tests: socket actions and error attribution, presence store, search and excerpts, message
  actions, and rendered interactions (CSS-only toolbar, portalled pins popover with jump,
  reactions, context menu, threads with their own draft, search jump, typing/seen display,
  single read receipt, receipts off).

Notes for later phases:
- The friends sidebar is still a placeholder (Phase 7).
- Testing tip: the browser pane can report a 0×0 viewport when collapsed; set a size with
  the pane's viewport emulation before measuring layout.
- Testing tip: in `dev:new:web`, Vite can load a store as `…store.ts?t=…` after a hot
  reload, so a console `import("/src/stores/…")` may get a second copy. Import the exact
  URL from `performance.getEntriesByType("resource")`.
