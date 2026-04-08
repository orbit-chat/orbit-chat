import { FormEvent, useEffect, useMemo, useState, useCallback } from "react";
import { useAuthStore } from "./stores/authStore";
import { useMessagesStore } from "./stores/messagesStore";
import { useSocketStore } from "./stores/socketStore";
import { useProfilesStore } from "./stores/profilesStore";
import { useE2EEStore } from "./stores/e2eeStore";
import * as api from "./lib/api";
import type { Conversation } from "./lib/api";
import { decryptMessage, encryptMessage, generateSecretKey, sealToPublicKey } from "./lib/crypto";
import { UserProfilePopover } from "./components/UserProfilePopover";
import { ProfileSettings } from "./components/ProfileSettings";

function latestPublicKey(keys: { publicKey: string; createdAt: string }[]) {
  if (!keys.length) return null;
  return keys
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]!
    .publicKey;
}

function DecryptedMessageText(props: {
  conversationId: string;
  cipherText: string;
  nonce?: string;
}) {
  const { conversationId, cipherText, nonce } = props;
  const e2ee = useE2EEStore();
  const [plain, setPlain] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const secretKey = e2ee.getConversationSecretKey(conversationId);
      if (!secretKey || !nonce) {
        setPlain(null);
        return;
      }

      try {
        const text = await decryptMessage(cipherText, nonce, secretKey);
        if (!cancelled) setPlain(text);
      } catch {
        if (!cancelled) setPlain(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [conversationId, cipherText, nonce, e2ee]);

  return <p className="mt-1 break-words text-orbit-text">{plain ?? "Encrypted message (unable to decrypt on this device)."}</p>;
}

function App() {
  const [appVersion, setAppVersion] = useState("-");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [mainView, setMainView] = useState<"chat" | "profile-settings">("chat");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [messageDraft, setMessageDraft] = useState("");

  const [profilePopoverUserId, setProfilePopoverUserId] = useState<string | null>(null);
  const [profilePopoverAnchor, setProfilePopoverAnchor] = useState<DOMRect | null>(null);

  // Server data
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<api.UserProfile[]>([]);

  const { user, clearSession, token, loading, error, login, signup } = useAuthStore();
  const { connected, connect, disconnect, socket } = useSocketStore();
  const { byConversation, upsertMessage } = useMessagesStore();
  const profiles = useProfilesStore();
  const e2ee = useE2EEStore();

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConvId) ?? null,
    [conversations, selectedConvId]
  );

  const dmPartner = useMemo(() => {
    if (!selectedConversation || !user) return null;
    if (selectedConversation.type !== "dm") return null;
    return selectedConversation.members.find((m) => m.user.id !== user.id)?.user ?? null;
  }, [selectedConversation, user]);

  const messages = useMemo(
    () => (selectedConvId ? byConversation[selectedConvId] ?? [] : []),
    [byConversation, selectedConvId]
  );

  // Get the "other" user's name in a DM
  const dmPartnerName = useMemo(() => {
    if (!selectedConversation || !user) return null;
    const other = selectedConversation.members.find((m) => m.user.id !== user.id);
    return other?.user.username ?? selectedConversation.name ?? "Chat";
  }, [selectedConversation, user]);

  const openProfilePopover = useCallback(
    async (userId: string, anchorEl?: HTMLElement | null) => {
      if (!token) return;
      setProfilePopoverUserId(userId);
      setProfilePopoverAnchor(anchorEl ? anchorEl.getBoundingClientRect() : null);
      await profiles.fetchProfile(userId, token);
    },
    [profiles, token]
  );

  const closeProfilePopover = useCallback(() => {
    setProfilePopoverUserId(null);
    setProfilePopoverAnchor(null);
  }, []);

  const openMyProfilePopover = useCallback(
    (anchorEl?: HTMLElement | null) => {
      if (!user?.id) return;
      void openProfilePopover(user.id, anchorEl);
    },
    [openProfilePopover, user?.id]
  );

  /* ───── Electron version ───── */
  useEffect(() => {
    window.electronAPI?.getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  /* ───── Connect socket when token changes ───── */
  useEffect(() => {
    if (!token) {
      disconnect();
      return;
    }
    connect(token);
    return () => disconnect();
  }, [token, connect, disconnect]);

  /* ───── Load conversations when authenticated ───── */
  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const convs = await api.getConversations(token);
      setConversations(convs);
    } catch {
      // silently fail — server might not be ready yet
    }
  }, [token]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!token || !user) return;
    profiles.fetchMe(token, user.id);
  }, [token, user?.id]);

  /* ───── Load messages when selecting a conversation ───── */
  useEffect(() => {
    if (!selectedConvId || !token) return;
    api.getMessages(selectedConvId, token).then((msgs) => {
      for (const m of msgs) {
        upsertMessage(selectedConvId, {
          id: m.id,
          senderId: m.sender.id,
          sender: m.sender.username,
          cipherText: m.ciphertext,
          nonce: m.nonce,
          createdAt: new Date(m.createdAt).getTime(),
        });
      }
    }).catch(() => {});

    // Join the room via socket
    socket?.emit("join_conversation", { conversationId: selectedConvId });
  }, [selectedConvId, token, socket]);

  /* ───── Ensure conversation secret key for DMs ───── */
  useEffect(() => {
    if (!token || !user || !selectedConversation) return;
    if (selectedConversation.type !== "dm") return;
    e2ee.ensureConversationSecretKey({ conversation: selectedConversation, token, myUserId: user.id });
  }, [token, user?.id, selectedConversation, e2ee]);

  /* ───── Search users ───── */
  useEffect(() => {
    const query = search.trim();
    if (!query || !token) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.searchUsers(query, token).then(setSearchResults).catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, token]);

  /* ───── Auth submit ───── */
  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authMode === "login") {
      await login(email.trim(), password);
    } else {
      await signup(email.trim(), username.trim(), password);
    }
    setPassword("");
  };

  /* ───── Start DM with a searched user ───── */
  const startDM = async (targetUser: api.UserProfile) => {
    if (!token) return;

    // Check if a DM already exists with this user
    const existing = conversations.find(
      (c) =>
        c.type === "dm" &&
        c.members.some((m) => m.user.id === targetUser.id)
    );
    if (existing) {
      setSelectedConvId(existing.id);
      setSearch("");
      setSearchResults([]);
      if (user) {
        await e2ee.ensureConversationSecretKey({ conversation: existing, token, myUserId: user.id });
      }
      return;
    }

    // Create a new DM conversation
    try {
      if (!user) return;

      const { publicKey: myPublicKey } = await e2ee.ensureDeviceKeypair(user.id, token);
      const otherKeys = await api.getUserKeys(targetUser.id, token);
      const otherPublicKey = latestPublicKey(otherKeys);
      if (!otherPublicKey) return;

      const secretKey = await generateSecretKey();
      const encryptedKeys: Record<string, string> = {
        [user.id]: await sealToPublicKey(secretKey, myPublicKey),
        [targetUser.id]: await sealToPublicKey(secretKey, otherPublicKey),
      };

      const conv = await api.createConversation(
        { type: "dm", memberIds: [targetUser.id], encryptedKeys },
        token
      );
      setConversations((prev) => [conv, ...prev]);
      setSelectedConvId(conv.id);
      setMainView("chat");
      setSearch("");
      setSearchResults([]);

      await e2ee.ensureConversationSecretKey({ conversation: conv, token, myUserId: user.id });
    } catch {
      // handle error
    }
  };

  /* ───── Send message over socket ───── */
  const handleSendMessage = () => {
    const draft = messageDraft.trim();
    if (!draft || !selectedConvId || !user || !socket) return;
    if (!token) return;

    if (!selectedConversation || selectedConversation.type !== "dm") return;

    (async () => {
      try {
        const secretKey = await e2ee.ensureConversationSecretKey({
          conversation: selectedConversation,
          token,
          myUserId: user.id,
        });
        if (!secretKey) return;

        const { cipherText, nonce } = await encryptMessage(draft, secretKey);

        socket.emit("send_message", {
          conversationId: selectedConvId,
          ciphertext: cipherText,
          nonce,
          keyVersion: 1,
        });

        setMessageDraft("");
      } catch {
        // ignore
      }
    })();
  };

  /* ════════════════════════════════════════════════════ */
  /*  AUTH SCREEN                                         */
  /* ════════════════════════════════════════════════════ */
  if (!user) {
    return (
      <div className="relative flex h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-orbit-bg via-orbit-panelAlt to-orbit-panel p-6 text-orbit-text">
        <section className="orbit-card relative z-10 w-full max-w-5xl rounded-3xl p-8">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
            <div className="space-y-6">
              <span className="inline-flex items-center gap-2 rounded-full border border-orbit-accent/40 px-3 py-1 text-xs uppercase tracking-[0.18em] text-orbit-accent">
                <img src="logo.png" alt="Orbit Chat logo" className="h-5 w-5 rounded-full object-cover" />
                Orbit Chat
              </span>
              <h1 className="text-4xl font-bold leading-tight md:text-5xl">
                Private desktop messaging for teams that move fast.
              </h1>
              <p className="max-w-xl text-sm text-slate-300">
                End-to-end encrypted architecture, ephemeral media controls, and a realtime shell built for low-friction conversation.
              </p>
              <div className="grid gap-3 text-xs text-slate-300 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">AES-style payload wrapping</div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">Secure local cache hooks</div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">Realtime socket transport</div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-orbit-panel p-6">
              <div className="mb-6 flex rounded-xl border border-white/10 bg-orbit-panelAlt p-1">
                <button
                  className={`w-1/2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    authMode === "login" ? "bg-orbit-accent text-slate-950" : "text-slate-300"
                  }`}
                  onClick={() => setAuthMode("login")}
                >
                  Login
                </button>
                <button
                  className={`w-1/2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    authMode === "signup" ? "bg-orbit-accent text-slate-950" : "text-slate-300"
                  }`}
                  onClick={() => setAuthMode("signup")}
                >
                  Sign Up
                </button>
              </div>

              {error && (
                <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
                  {error}
                </div>
              )}

              <form className="space-y-4" onSubmit={handleAuthSubmit}>
                <label className="block">
                  <span className="orbit-label">Email</span>
                  <input
                    className="orbit-input"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                  />
                </label>
                {authMode === "signup" && (
                  <label className="block">
                    <span className="orbit-label">Username</span>
                    <input
                      className="orbit-input"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="your-name"
                      autoComplete="username"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="orbit-label">Password</span>
                  <input
                    className="orbit-input"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="********"
                    type="password"
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  />
                </label>
                <button
                  disabled={loading}
                  className="orbit-btn-primary w-full"
                >
                  {loading ? "Please wait..." : authMode === "login" ? "Login" : "Create Account"}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════ */
  /*  MAIN CHAT SCREEN                                    */
  /* ════════════════════════════════════════════════════ */
  return (
    <div className="h-screen overflow-hidden bg-gradient-to-b from-orbit-bg to-orbit-panelAlt text-orbit-text">
      <div className="grid h-full grid-cols-[82px_320px_1fr]">
        {/* ───── Left icon rail ───── */}
        <aside className="border-r border-white/10 bg-orbit-panelAlt/60 p-3">
          <div className="mb-4 flex items-center justify-center rounded-xl bg-orbit-accent/15 p-2">
            <img src="logo.png" alt="Orbit Chat logo" className="h-10 w-10 rounded-xl object-cover" />
          </div>
          <div className="space-y-3 text-center text-xs text-orbit-muted">
            <div className="rounded-xl border border-white/10 bg-orbit-panel/90 p-2">DM</div>
            <div className="rounded-xl border border-white/10 bg-orbit-panel/90 p-2">Friends</div>
            <div className="rounded-xl border border-white/10 bg-orbit-panel/90 p-2">Archive</div>
          </div>
        </aside>

        {/* ───── Sidebar: search + conversation list ───── */}
        <aside className="border-r border-white/10 bg-orbit-panel p-4">
          <h1 className="text-lg font-semibold">Orbit Direct Messages</h1>
          <p className="mt-1 text-sm text-orbit-muted">Search users and start secure chats</p>

          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Search users</span>
            <input
              className="orbit-input py-2"
              placeholder="Search username..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-orbit-muted">Search results</p>
              {searchResults.map((u) => (
                <div key={u.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-orbit-panelAlt p-2">
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-orbit-text hover:underline"
                    onClick={(event) => openProfilePopover(u.id, event.currentTarget)}
                  >
                    @{u.username}
                  </button>
                  <button
                    className="orbit-btn px-3 py-2 text-xs"
                    onClick={() => startDM(u)}
                  >
                    Chat
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Conversation list */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent chats</p>
            <span className="text-xs text-orbit-muted">{conversations.length}</span>
          </div>

          <div className="mt-2 space-y-2 overflow-y-auto pr-1">
            {conversations.map((conv) => {
              const isSelected = conv.id === selectedConvId;
              const otherMember = conv.members.find((m) => m.user.id !== user.id);
              const displayName =
                conv.type === "dm"
                  ? otherMember?.user.username ?? "DM"
                  : conv.name ?? "Group";
              return (
                <button
                  key={conv.id}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? "border-orbit-accent/60 bg-orbit-accent/10"
                      : "border-white/5 bg-orbit-panelAlt hover:border-white/20"
                  }`}
                  onClick={() => setSelectedConvId(conv.id)}
                >
                  <p className="text-sm font-semibold">@{displayName}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {conv.type === "dm" ? "Direct message" : `${conv.members.length} members`}
                  </p>
                </button>
              );
            })}
            {conversations.length === 0 && (
              <p className="text-xs text-orbit-muted">No conversations yet. Search for a user above to start one.</p>
            )}
          </div>

          <div className="orbit-card-solid mt-4 rounded-xl bg-orbit-panelAlt p-4 text-sm">
            <p className="font-semibold">Build {appVersion}</p>
            <p className={connected ? "text-emerald-400" : "text-rose-400"}>
              Socket: {connected ? "Connected" : "Disconnected"}
            </p>
          </div>
        </aside>

        {/* ───── Main content area ───── */}
        <main className="flex h-full flex-col bg-gradient-to-b from-orbit-bg to-orbit-panelAlt">
          <header className="flex items-center justify-end gap-3 border-b border-white/10 bg-orbit-panel/40 px-4 py-3 backdrop-blur">
            <button
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-orbit-text hover:border-white/20"
              onClick={(event) => openMyProfilePopover(event.currentTarget)}
            >
              @{user.username}
            </button>
            <button
              className="orbit-btn h-10 w-10 p-0"
              onClick={() => {
                setMainView("profile-settings");
                setSelectedConvId(null);
                closeProfilePopover();
              }}
              aria-label="Open profile settings"
              title="Profile settings"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .38.13.74.36 1.03.23.29.56.49.92.56H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1 .33 1.65 1.65 0 0 0-.6 1z" />
              </svg>
            </button>
            <button
              className="orbit-btn-danger px-4 py-2 text-xs"
              onClick={() => {
                clearSession();
                setSelectedConvId(null);
                setSearch("");
                setConversations([]);
                setMainView("chat");
                closeProfilePopover();
              }}
            >
              Sign Out
            </button>
          </header>

          <section className="min-h-0 flex-1">
            {mainView === "profile-settings" && token && user ? (
              <ProfileSettings
                token={token}
                myUserId={user.id}
                onClose={() => {
                  setMainView("chat");
                }}
              />
            ) : !selectedConversation ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="orbit-card max-w-xl rounded-3xl p-8 text-center">
                  <h2 className="text-3xl font-bold">Welcome back, {user.username}</h2>
                  <p className="mt-3 text-sm text-slate-300">
                    Pick someone from the sidebar to start a private conversation. Message history and encrypted payload previews will appear here.
                  </p>
                  <div className="mt-6 grid gap-3 text-left text-sm text-slate-300 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">Search users by username</div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">View online presence</div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">Open secure DM threads</div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">Send encrypted payloads</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col">
            <header className="flex items-center justify-between border-b border-white/10 bg-orbit-panel/40 p-4 backdrop-blur">
              <div>
                <button
                  className="text-left text-base font-semibold text-orbit-text hover:underline"
                  onClick={(e) => {
                    if (!dmPartner?.id) return;
                    openProfilePopover(dmPartner.id, e.currentTarget);
                  }}
                >
                  @{dmPartnerName}
                </button>
                <p className="text-xs text-orbit-muted">Direct encrypted chat</p>
              </div>
              {e2ee.getConversationSecretKey(selectedConversation.id) ? (
                <span className="rounded-full border border-orbit-accent/40 px-3 py-1 text-xs text-orbit-accent">E2E Encrypted</span>
              ) : e2ee.loadingByConversationId[selectedConversation.id] ? (
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-orbit-muted">Setting up encryption…</span>
              ) : (
                <span className="rounded-full border border-orbit-danger/40 px-3 py-1 text-xs text-orbit-danger">Encryption unavailable</span>
              )}
            </header>

            <section className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="text-sm text-orbit-muted">No messages yet. Send your first encrypted payload.</p>
              )}
              {messages.map((msg) => {
                const mine = msg.sender === user.username;
                return (
                  <article
                    key={msg.id}
                    className={`max-w-[80%] rounded-2xl border p-3 text-sm ${
                      mine
                        ? "ml-auto border-orbit-accent/20 bg-orbit-accent/15"
                        : "border-white/10 bg-orbit-panel/90"
                    }`}
                  >
                    <button
                      className="font-semibold text-orbit-accent hover:underline"
                      onClick={(e) => openProfilePopover(msg.senderId, e.currentTarget)}
                    >
                      {msg.sender}
                    </button>
                    <DecryptedMessageText conversationId={selectedConversation.id} cipherText={msg.cipherText} nonce={msg.nonce} />
                  </article>
                );
              })}
            </section>

            <footer className="border-t border-white/10 bg-orbit-panel/40 p-4 backdrop-blur">
              <div className="flex gap-3">
                <input
                  className="orbit-input flex-1 px-4"
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Type message..."
                />
                <button
                  className="orbit-btn-primary px-5"
                  onClick={handleSendMessage}
                >
                  Send
                </button>
              </div>
            </footer>
              </div>
            )}
          </section>
        </main>

        <UserProfilePopover
          open={Boolean(profilePopoverUserId)}
          anchorRect={profilePopoverAnchor}
          profile={profilePopoverUserId ? profiles.byId[profilePopoverUserId] ?? null : null}
          loading={profilePopoverUserId ? profiles.loadingById[profilePopoverUserId] ?? false : false}
          error={profilePopoverUserId ? profiles.errorById[profilePopoverUserId] ?? null : null}
          onClose={closeProfilePopover}
          canEdit={Boolean(user && profilePopoverUserId && user.id === profilePopoverUserId)}
          onEditClick={() => {
            setMainView("profile-settings");
            setSelectedConvId(null);
          }}
        />
      </div>
    </div>
  );
}

export default App;
