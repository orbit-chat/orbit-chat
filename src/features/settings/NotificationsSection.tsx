import { useState } from "react";
import { Alert, Button, cn } from "../../ui";
import { usePrefsStore, useUserPrefs, type NotificationMode } from "../../stores/prefsStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useAuthStore } from "../../stores/authStore";
import { useConversationsStore } from "../conversations/conversationsStore";
import { conversationTitle } from "../conversations/selectors";
import { notificationsSupported, playChime, showNotification } from "../notifications/useNotifications";

const MODES: Array<{ value: NotificationMode; label: string; description: string }> = [
  { value: "all", label: "All messages", description: "Notify for every new message in chats that aren't muted." },
  { value: "mentions", label: "Mentions only", description: "Only when someone @mentions you." },
  { value: "off", label: "Off", description: "No desktop notifications or sounds." }
];

export function NotificationsSection() {
  const prefs = useUserPrefs();
  const n = prefs.notifications;
  const set = usePrefsStore.getState().setNotifications;
  const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : "denied"));
  const myUserId = useAuthStore((s) => s.user?.id ?? "");
  const conversations = useConversationsStore((s) => s.conversations);
  const profiles = useProfilesStore((s) => s.byId);
  const muted = conversations.filter((c) => prefs.mutedConversationIds.includes(c.id));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">Notifications</h1>
        <p className="mt-1 text-sm text-orbit-muted">You're never notified about the chat you're looking at.</p>
      </header>

      {permission !== "granted" && (
        <Alert tone="warning">
          {permission === "denied" ? (
            "Notifications are blocked for Orbit by your system. Allow them in your OS notification settings."
          ) : (
            <span className="flex flex-wrap items-center justify-between gap-2">
              Orbit needs permission to show notifications.
              <Button size="sm" variant="primary" onClick={async () => setPermission(await Notification.requestPermission())}>
                Allow notifications
              </Button>
            </span>
          )}
        </Alert>
      )}

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Notify me about</h2>
        <div role="radiogroup" aria-label="Notify me about" className="grid gap-2 sm:grid-cols-3">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={n.mode === mode.value}
              onClick={() => set({ mode: mode.value })}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
                n.mode === mode.value ? "border-orbit-accent/60 bg-orbit-accent/10" : "border-white/10 hover:border-white/20"
              )}
            >
              <span className="block text-sm font-semibold">{mode.label}</span>
              <span className="mt-0.5 block text-[11px] text-orbit-muted">{mode.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-orbit-panel/60 px-5">
        <Switch
          label="Show message text"
          description="Off keeps notifications to “New message”. Text shown by the OS can stay in its notification history. Never shown for passcode chats."
          checked={n.showPreview}
          disabled={n.mode === "off"}
          onChange={(showPreview) => set({ showPreview })}
        />
        <Switch label="Play a sound" description="A short chime with each notification." checked={n.sound} disabled={n.mode === "off"} onChange={(sound) => set({ sound })} />
      </section>

      <Button
        size="sm"
        disabled={n.mode === "off"}
        onClick={() => {
          showNotification({ title: "Orbit Chat", body: n.showPreview ? "This is what a message preview looks like." : "New message", conversationId: "test" });
          if (n.sound) playChime();
        }}
      >
        Send a test notification
      </Button>

      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Muted chats — {muted.length}</h2>
        {muted.length === 0 ? (
          <p className="text-sm text-orbit-muted">None. Mute a chat from its menu or its settings.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Muted chats">
            {muted.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-orbit-panel/50 px-3 py-2">
                <span className="truncate text-sm">{conversationTitle(c, myUserId, profiles)}</span>
                <Button size="sm" variant="ghost" onClick={() => usePrefsStore.getState().toggleMuted(c.id)}>
                  Unmute
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Switch({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-3.5", disabled && "opacity-50")}>
      <div>
        <p className="text-sm">{label}</p>
        <p className="mt-0.5 text-[11px] text-orbit-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
          checked ? "bg-orbit-accent" : "bg-white/15"
        )}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </div>
  );
}
