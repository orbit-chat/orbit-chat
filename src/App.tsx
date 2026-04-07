import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "./stores/authStore";
import { useMessagesStore } from "./stores/messagesStore";
import { useSocketStore } from "./stores/socketStore";

function App() {
  const [appVersion, setAppVersion] = useState("-");
  const { user, setSession, clearSession, token } = useAuthStore();
  const { connected, connect, disconnect } = useSocketStore();
  const { byConversation, upsertMessage } = useMessagesStore();
  const activeConversationId = "general";

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

  return (
    <div className="h-screen bg-orbit-bg text-orbit-text">
      <div className="grid h-full grid-cols-[84px_280px_1fr]">
        <aside className="border-r border-slate-800 bg-black/30 p-3">
          <div className="mb-4 rounded-xl bg-orbit-accent/10 p-3 text-center font-semibold text-orbit-accent">OC</div>
          <div className="space-y-3 text-center text-xs text-orbit-muted">
            <div className="rounded-lg bg-orbit-panel p-2">DM</div>
            <div className="rounded-lg bg-orbit-panel p-2">PRJ</div>
          </div>
        </aside>

        <aside className="border-r border-slate-800 bg-orbit-panel p-4">
          <h1 className="text-lg font-semibold">Orbit Chat</h1>
          <p className="mt-1 text-sm text-orbit-muted">Encrypted desktop messenger</p>

          <div className="mt-6 rounded-xl bg-orbit-panelAlt p-4 text-sm">
            <p>Build: {appVersion}</p>
            <p className={connected ? "text-emerald-400" : "text-rose-400"}>
              Socket: {connected ? "Connected" : "Disconnected"}
            </p>
          </div>

          {!user ? (
            <button
              className="mt-4 w-full rounded-lg bg-orbit-accent px-3 py-2 font-semibold text-slate-900"
              onClick={() =>
                setSession("dev-token", {
                  id: "u-1",
                  username: "local-user"
                })
              }
            >
              Quick Sign In
            </button>
          ) : (
            <button
              className="mt-4 w-full rounded-lg bg-orbit-danger px-3 py-2 font-semibold text-white"
              onClick={clearSession}
            >
              Sign Out
            </button>
          )}
        </aside>

        <main className="flex flex-col bg-[radial-gradient(circle_at_20%_0%,rgba(45,212,191,0.12),transparent_40%),linear-gradient(160deg,#0d1117_10%,#101a2f_100%)]">
          <header className="border-b border-slate-800 p-4">
            <h2 className="text-base font-semibold"># general</h2>
          </header>

          <section className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && <p className="text-sm text-orbit-muted">No messages yet.</p>}
            {messages.map((msg) => (
              <article key={msg.id} className="rounded-xl bg-orbit-panel/90 p-3 text-sm">
                <p className="font-semibold text-orbit-accent">{msg.sender}</p>
                <p className="mt-1 break-all text-orbit-text">{msg.cipherText}</p>
              </article>
            ))}
          </section>

          <footer className="border-t border-slate-800 p-4">
            <button
              className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900"
              onClick={() =>
                upsertMessage(activeConversationId, {
                  id: crypto.randomUUID(),
                  sender: user?.username ?? "system",
                  cipherText: "encrypted-payload-placeholder",
                  createdAt: Date.now()
                })
              }
            >
              Add Encrypted Placeholder
            </button>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
