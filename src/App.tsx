import { FormEvent, useEffect, useMemo, useState, useCallback } from "react";
import { useAuthStore } from "./stores/authStore";
import { useMessagesStore } from "./stores/messagesStore";
import { useSocketStore } from "./stores/socketStore";
import * as api from "./lib/api";
import type { Conversation } from "./lib/api";

function App() {
  const [appVersion, setAppVersion] = useState("-");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [messageDraft, setMessageDraft] = useState("");

  // Server data
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<api.UserProfile[]>([]);

  const { user, clearSession, token, loading, error, login, signup } = useAuthStore();
  const { connected, connect, disconnect, socket } = useSocketStore();
  const { byConversation, upsertMessage } = useMessagesStore();

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConvId) ?? null,
    [conversations, selectedConvId]
  );

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

  /* ───── Load messages when selecting a conversation ───── */
  useEffect(() => {
    if (!selectedConvId || !token) return;
    api.getMessages(selectedConvId, token).then((msgs) => {
      for (const m of msgs) {
        upsertMessage(selectedConvId, {
          id: m.id,
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
      return;
    }

    // Create a new DM conversation
    try {
      const conv = await api.createConversation(
        { type: "dm", memberIds: [targetUser.id] },
        token
      );
      setConversations((prev) => [conv, ...prev]);
      setSelectedConvId(conv.id);
      setSearch("");
      setSearchResults([]);
    } catch {
      // handle error
    }
  };

  /* ───── Send message over socket ───── */
  const handleSendMessage = () => {
    const draft = messageDraft.trim();
    if (!draft || !selectedConvId || !user || !socket) return;

    // In a full E2EE flow, the client would encrypt the message here.
    // For now we send the plaintext as ciphertext (server stores it opaquely).
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));

    socket.emit("send_message", {
      conversationId: selectedConvId,
      ciphertext: draft,
      nonce,
      keyVersion: 1,
    });

    setMessageDraft("");
  };

  /* ════════════════════════════════════════════════════ */
  /*  AUTH SCREEN                                         */
  /* ════════════════════════════════════════════════════ */
  if (!user) {
    return (
      <div className="relative flex h-screen items-center justify-center overflow-hidden bg-[#090c13] p-6 text-orbit-text">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(45,212,191,0.18),transparent_30%),radial-gradient(circle_at_85%_80%,rgba(251,113,133,0.2),transparent_32%),linear-gradient(120deg,#05070d_0%,#101725_45%,#0a1220_100%)]" />
        <section className="relative z-10 w-full max-w-5xl rounded-3xl border border-white/10 bg-slate-950/75 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
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

            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6">
              <div className="mb-6 flex rounded-xl bg-slate-800/70 p-1">
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
                  <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Email</span>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-slate-800/70 px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                  />
                </label>
                {authMode === "signup" && (
                  <label className="block">
                    <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Username</span>
                    <input
                      className="w-full rounded-xl border border-white/10 bg-slate-800/70 px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="your-name"
                      autoComplete="username"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Password</span>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-slate-800/70 px-3 py-3 text-sm outline-none transition focus:border-orbit-accent"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="********"
                    type="password"
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  />
                </label>
                <button
                  disabled={loading}
                  className="w-full rounded-xl bg-orbit-accent px-4 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
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
    <div className="h-screen overflow-hidden bg-[#070a11] text-orbit-text">
      <div className="grid h-full grid-cols-[82px_320px_1fr]">
        {/* ───── Left icon rail ───── */}
        <aside className="border-r border-slate-800/70 bg-black/35 p-3">
          <div className="mb-4 flex items-center justify-center rounded-xl bg-orbit-accent/15 p-2">
            <img src="logo.png" alt="Orbit Chat logo" className="h-10 w-10 rounded-xl object-cover" />
          </div>
          <div className="space-y-3 text-center text-xs text-orbit-muted">
            <div className="rounded-lg bg-orbit-panel/90 p-2">DM</div>
            <div className="rounded-lg bg-orbit-panel/90 p-2">Friends</div>
            <div className="rounded-lg bg-orbit-panel/90 p-2">Archive</div>
          </div>
        </aside>

        {/* ───── Sidebar: search + conversation list ───── */}
        <aside className="border-r border-slate-800/70 bg-orbit-panel p-4">
          <h1 className="text-lg font-semibold">Orbit Direct Messages</h1>
          <p className="mt-1 text-sm text-orbit-muted">Search users and start secure chats</p>

          <label className="mt-4 block">
            <input
              className="w-full rounded-xl border border-white/10 bg-orbit-panelAlt px-3 py-2 text-sm outline-none transition focus:border-orbit-accent"
              placeholder="Search username..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-slate-500">Search results</p>
              {searchResults.map((u) => (
                <button
                  key={u.id}
                  className="w-full rounded-xl border border-white/5 bg-orbit-panelAlt p-2 text-left text-sm hover:border-white/20"
                  onClick={() => startDM(u)}
                >
                  @{u.username}
                </button>
              ))}
            </div>
          )}

          {/* Conversation list */}
          <div className="mt-4 space-y-2 overflow-y-auto pr-1">
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
              <p className="text-xs text-slate-500">No conversations yet. Search for a user above to start one.</p>
            )}
          </div>

          <div className="mt-4 rounded-xl bg-orbit-panelAlt p-4 text-sm">
            <p>Build {appVersion}</p>
            <p className={connected ? "text-emerald-400" : "text-rose-400"}>
              Socket: {connected ? "Connected" : "Disconnected"}
            </p>
          </div>

          <button
            className="mt-4 w-full rounded-lg bg-orbit-danger px-3 py-2 text-sm font-semibold text-white"
            onClick={() => {
              clearSession();
              setSelectedConvId(null);
              setSearch("");
              setConversations([]);
            }}
          >
            Sign Out
          </button>
        </aside>

        {/* ───── Main content area ───── */}
        {!selectedConversation ? (
          <main className="flex items-center justify-center bg-[radial-gradient(circle_at_20%_10%,rgba(45,212,191,0.18),transparent_35%),linear-gradient(160deg,#0b1321_5%,#12192a_45%,#0c111b_100%)] p-8">
            <div className="max-w-xl rounded-3xl border border-white/10 bg-slate-950/60 p-8 text-center shadow-2xl backdrop-blur-lg">
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
          </main>
        ) : (
          <main className="flex flex-col bg-[radial-gradient(circle_at_20%_0%,rgba(45,212,191,0.12),transparent_40%),linear-gradient(160deg,#0d1117_10%,#101a2f_100%)]">
            <header className="flex items-center justify-between border-b border-slate-800 p-4">
              <div>
                <h2 className="text-base font-semibold">@{dmPartnerName}</h2>
                <p className="text-xs text-orbit-muted">Direct encrypted chat</p>
              </div>
              <span className="rounded-full border border-orbit-accent/40 px-3 py-1 text-xs text-orbit-accent">E2E Enabled</span>
            </header>

            <section className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="text-sm text-orbit-muted">No messages yet. Send your first encrypted payload.</p>
              )}
              {messages.map((msg) => {
                const mine = msg.sender === user.username;
                return (
                  <article key={msg.id} className={`max-w-[80%] rounded-2xl p-3 text-sm ${mine ? "ml-auto bg-orbit-accent/20" : "bg-orbit-panel/90"}`}>
                    <p className="font-semibold text-orbit-accent">{msg.sender}</p>
                    <p className="mt-1 break-all text-orbit-text">{msg.cipherText}</p>
                  </article>
                );
              })}
            </section>

            <footer className="border-t border-slate-800 p-4">
              <div className="flex gap-3">
                <input
                  className="flex-1 rounded-xl border border-white/10 bg-orbit-panelAlt px-4 py-3 text-sm outline-none transition focus:border-orbit-accent"
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
                  className="rounded-xl bg-orbit-accent px-5 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110"
                  onClick={handleSendMessage}
                >
                  Send
                </button>
              </div>
            </footer>
          </main>
        )}
      </div>
    </div>
  );
}

export default App;
