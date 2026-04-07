import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "./stores/authStore";
import { useMessagesStore } from "./stores/messagesStore";
import { useSocketStore } from "./stores/socketStore";

type UserPreview = {
  id: string;
  username: string;
  status: "online" | "idle" | "offline";
  lastSeen: string;
};

const MOCK_USERS: UserPreview[] = [
  { id: "u-101", username: "nova", status: "online", lastSeen: "Active now" },
  { id: "u-102", username: "relay", status: "idle", lastSeen: "2m ago" },
  { id: "u-103", username: "cipher", status: "offline", lastSeen: "45m ago" },
  { id: "u-104", username: "atlas", status: "online", lastSeen: "Active now" },
  { id: "u-105", username: "kairo", status: "offline", lastSeen: "1h ago" }
];

function App() {
  const [appVersion, setAppVersion] = useState("-");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const { user, setSession, clearSession, token } = useAuthStore();
  const { connected, connect, disconnect } = useSocketStore();
  const { byConversation, upsertMessage } = useMessagesStore();

  const selectedUser = useMemo(
    () => MOCK_USERS.find((candidate) => candidate.id === selectedUserId) ?? null,
    [selectedUserId]
  );
  const activeConversationId = selectedUser ? `dm:${selectedUser.id}` : "lobby";

  useEffect(() => {
    window.electronAPI.getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  useEffect(() => {
    if (!token) {
      disconnect();
      return;
    }
    connect(token);
    return () => disconnect();
  }, [token, connect, disconnect]);

  const messages = useMemo(() => byConversation[activeConversationId] ?? [], [byConversation]);
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return MOCK_USERS;
    return MOCK_USERS.filter((candidate) => candidate.username.toLowerCase().includes(query));
  }, [search]);

  const handleAuthSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    if (!trimmedUsername || !trimmedPassword) return;

    setSession(`token-${trimmedUsername}`, {
      id: `local-${trimmedUsername}`,
      username: trimmedUsername
    });
    setPassword("");
  };

  const handleSendMessage = () => {
    const draft = messageDraft.trim();
    if (!draft || !selectedUser || !user) return;

    upsertMessage(activeConversationId, {
      id: crypto.randomUUID(),
      sender: user.username,
      cipherText: `enc:${btoa(unescape(encodeURIComponent(draft))).slice(0, 42)}...`,
      createdAt: Date.now()
    });

    setTimeout(() => {
      upsertMessage(activeConversationId, {
        id: crypto.randomUUID(),
        sender: selectedUser.username,
        cipherText: "enc:auto-reply-payload",
        createdAt: Date.now() + 1
      });
    }, 350);

    setMessageDraft("");
  };

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

              <form className="space-y-4" onSubmit={handleAuthSubmit}>
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
                <button className="w-full rounded-xl bg-orbit-accent px-4 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110">
                  {authMode === "login" ? "Login" : "Create Account"}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#070a11] text-orbit-text">
      <div className="grid h-full grid-cols-[82px_320px_1fr]">
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

          <div className="mt-4 space-y-2 overflow-y-auto pr-1">
            {filteredUsers.map((candidate) => {
              const isSelected = candidate.id === selectedUserId;
              return (
                <button
                  key={candidate.id}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? "border-orbit-accent/60 bg-orbit-accent/10"
                      : "border-white/5 bg-orbit-panelAlt hover:border-white/20"
                  }`}
                  onClick={() => setSelectedUserId(candidate.id)}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">@{candidate.username}</p>
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        candidate.status === "online"
                          ? "bg-emerald-400"
                          : candidate.status === "idle"
                            ? "bg-amber-400"
                            : "bg-slate-500"
                      }`}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{candidate.lastSeen}</p>
                </button>
              );
            })}
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
              setSelectedUserId(null);
              setSearch("");
            }}
          >
            Sign Out
          </button>
        </aside>

        {!selectedUser ? (
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
                <h2 className="text-base font-semibold">@{selectedUser.username}</h2>
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
                  placeholder="Type message... (encrypted preview will be shown)"
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
