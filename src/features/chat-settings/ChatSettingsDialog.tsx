import { useState, type ReactNode } from "react";
import { Alert, Avatar, Badge, Button, DialogClose, DialogContent, Field, Input, cn } from "../../ui";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useChatLockStore } from "../../stores/chatLockStore";
import { usePrefsStore, useUserPrefs, DEFAULT_CHAT_REALTIME } from "../../stores/prefsStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useConversationsStore, type Conversation } from "../conversations/conversationsStore";
import { removeGroupMember } from "../groups/groupKeys";
import { useDialogStore } from "./dialogStore";
import { usePasscodeRevealStore } from "./passcodeRevealStore";

const LOCK_MODES: Array<{ value: api.ChatLockMode; label: string; description: string }> = [
  { value: "on_leave", label: "When I leave the chat", description: "Locks as soon as you open another chat or page." },
  { value: "on_logout", label: "When I sign out", description: "Stays unlocked for the rest of this session." },
  { value: "after_time", label: "After a set time", description: "Locks a fixed time after you unlock it." },
  { value: "after_inactivity", label: "After inactivity", description: "Locks when you haven't used the app for a while." }
];
const TIMEOUT_PRESETS = [30, 60, 300, 900, 3600];

export function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/** Validates the lock section; returns an error message or null. */
export function validateLockSettings(input: { passcodeEnabled: boolean; originalLength: number; length: number; passcode: string; lockMode: api.ChatLockMode; timeout: number }) {
  if (input.passcode && input.passcode.length !== input.length) return `The new passcode must be ${input.length} digits.`;
  if (input.passcodeEnabled && input.length !== input.originalLength && !input.passcode) return `Enter a new ${input.length}-digit passcode to change its length.`;
  if ((input.lockMode === "after_time" || input.lockMode === "after_inactivity") && (!Number.isFinite(input.timeout) || input.timeout < 10)) {
    return "The lock timeout must be at least 10 seconds.";
  }
  return null;
}

/**
 * Settings for one conversation. Name and lock options save together; passcode
 * protection, members, archive and delete act immediately and say so.
 */
export function ChatSettingsDialog({ conversation, title }: { conversation: Conversation; title: string }) {
  const me = useAuthStore((s) => s.user)!;
  const prefs = useUserPrefs();
  const realtime = prefs.chatRealtime[conversation.id] ?? DEFAULT_CHAT_REALTIME;
  const archived = prefs.archivedConversationIds.includes(conversation.id);

  const [name, setName] = useState(conversation.name ?? "");
  const [lockMode, setLockMode] = useState<api.ChatLockMode>(conversation.lockMode);
  const [timeout, setTimeoutSeconds] = useState(conversation.lockTimeoutSeconds ?? 300);
  const [length, setLength] = useState(conversation.passcodeLength || 4);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== (conversation.name ?? "").trim() ||
    lockMode !== conversation.lockMode ||
    ((lockMode === "after_time" || lockMode === "after_inactivity") && timeout !== conversation.lockTimeoutSeconds) ||
    length !== conversation.passcodeLength ||
    passcode.length > 0;
  const validation = validateLockSettings({ passcodeEnabled: conversation.passcodeEnabled, originalLength: conversation.passcodeLength, length, passcode, lockMode, timeout });

  const save = async () => {
    const token = useAuthStore.getState().token;
    if (!token || validation) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateChatSettings(
        conversation.id,
        {
          name: name.trim(),
          lockMode,
          passcodeLength: length,
          ...(passcode ? { passcode } : {}),
          ...(lockMode === "after_time" || lockMode === "after_inactivity" ? { lockTimeoutSeconds: Math.round(timeout) } : {})
        },
        token
      );
      useConversationsStore.getState().upsert(updated);
      // Re-arm the lock timers with the new mode if the chat is open right now.
      if (useChatLockStore.getState().unlocked[updated.id]) useChatLockStore.getState().unlock(updated.id, updated.lockMode, updated.lockTimeoutSeconds);
      useDialogStore.getState().close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save settings.");
      setBusy(false);
    }
  };

  return (
    <DialogContent
      title="Chat settings"
      description={title}
      size="lg"
      dismissible={!busy}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {dirty ? "Cancel" : "Close"}
            </Button>
          </DialogClose>
          <Button variant="primary" disabled={busy || !dirty || Boolean(validation)} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}

        <Section title="Name">
          <Field label="Chat name" hint="Shown to everyone in the chat. Leave blank to use member names.">
            {(field) => <Input {...field} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder={title} />}
          </Field>
        </Section>

        <Section title="Locking">
          <div role="radiogroup" aria-label="Lock mode" className="grid gap-2 sm:grid-cols-2">
            {LOCK_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={lockMode === mode.value}
                onClick={() => setLockMode(mode.value)}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
                  lockMode === mode.value ? "border-orbit-accent/60 bg-orbit-accent/10" : "border-white/10 hover:border-white/20"
                )}
              >
                <span className="block text-sm font-semibold">{mode.label}</span>
                <span className="mt-0.5 block text-[11px] text-orbit-muted">{mode.description}</span>
              </button>
            ))}
          </div>
          {(lockMode === "after_time" || lockMode === "after_inactivity") && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Lock after</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {TIMEOUT_PRESETS.map((s) => (
                  <Button key={s} size="sm" variant={timeout === s ? "primary" : "secondary"} onClick={() => setTimeoutSeconds(s)} aria-pressed={timeout === s}>
                    {formatSeconds(s)}
                  </Button>
                ))}
                <Input
                  type="number"
                  min={10}
                  aria-label="Lock timeout in seconds"
                  value={timeout}
                  onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                  className="h-7 w-24 text-xs"
                />
                <span className="text-xs text-orbit-muted">seconds</span>
              </div>
            </div>
          )}
          {conversation.passcodeEnabled && (
            <div className="mt-4 grid gap-3 sm:grid-cols-[8rem_1fr]">
              <Field label="Digits">
                {(field) => (
                  <select
                    {...field}
                    value={length}
                    onChange={(e) => setLength(Number(e.target.value))}
                    className="h-9 w-full rounded-lg border border-white/10 bg-orbit-panelAlt px-2 text-sm text-orbit-text outline-none focus:border-orbit-accent/80"
                  >
                    {[2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="New passcode" hint="Leave blank to keep the current one." error={passcode || length !== conversation.passcodeLength ? validation : null}>
                {(field) => (
                  <Input
                    {...field}
                    inputMode="numeric"
                    autoComplete="off"
                    value={passcode}
                    maxLength={6}
                    onChange={(e) => setPasscode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder={"•".repeat(length)}
                    className="font-mono tracking-[0.3em]"
                  />
                )}
              </Field>
            </div>
          )}
        </Section>

        <PasscodeProtection conversation={conversation} myUserId={me.id} />

        <Section title="On this device" description="Only affects you.">
          <Toggle
            label="Mute notifications"
            description="No desktop notifications or sounds for this chat."
            checked={prefs.mutedConversationIds.includes(conversation.id)}
            onChange={() => usePrefsStore.getState().toggleMuted(conversation.id)}
          />
          <Toggle
            label="Send read receipts"
            description="Let others see when you've read their messages."
            checked={realtime.readReceipts}
            onChange={(readReceipts) => usePrefsStore.getState().setChatRealtime(conversation.id, { readReceipts })}
          />
          <Toggle
            label="Typing indicators"
            description="Show and share when someone is typing."
            checked={realtime.typingIndicators}
            onChange={(typingIndicators) => usePrefsStore.getState().setChatRealtime(conversation.id, { typingIndicators })}
          />
        </Section>

        {conversation.type === "group" && <Members conversation={conversation} myUserId={me.id} />}

        <Section title="Danger zone">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => usePrefsStore.getState().toggleArchived(conversation.id)}>
              {archived ? "Unarchive" : "Archive"}
            </Button>
            <Button size="sm" variant="danger" onClick={() => useDialogStore.getState().open({ kind: "deleteOrLeave", conversationId: conversation.id })}>
              {conversation.type === "dm" ? "Delete chat…" : "Leave group…"}
            </Button>
          </div>
        </Section>
      </div>
    </DialogContent>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</h3>
      {description && <p className="mt-0.5 text-[11px] text-orbit-muted">{description}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-1 py-2">
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-[11px] text-orbit-muted">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
          checked ? "bg-orbit-accent" : "bg-white/15"
        )}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

/**
 * Turning a passcode off needs both people to agree; either can turn it back on.
 * These act immediately rather than waiting for Save.
 */
function PasscodeProtection({ conversation, myUserId }: { conversation: Conversation; myUserId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: (token: string) => Promise<void>) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await fn(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const requester = conversation.members.find((m) => m.userId === conversation.passcodeDisableRequestedBy);
  let body: ReactNode;
  if (!conversation.passcodeEnabled) {
    body = (
      <>
        <p className="text-sm">
          Passcode protection is <Badge tone="warning">off</Badge>
        </p>
        <p className="mt-1 text-[11px] text-orbit-muted">Turning it on creates a new passcode that everyone in the chat is shown once.</p>
        <Button
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={() =>
            act(async (token) => {
              const result = await api.reenablePasscode(conversation.id, token);
              useConversationsStore.getState().upsert(result.conversation);
              usePasscodeRevealStore.getState().show({ conversationId: conversation.id, passcode: result.passcode, label: result.conversation.name ?? "This chat" });
              useChatLockStore.getState().unlock(conversation.id, result.conversation.lockMode, result.conversation.lockTimeoutSeconds);
            })
          }
        >
          {busy ? "Turning on…" : "Turn on passcode"}
        </Button>
      </>
    );
  } else if (conversation.passcodeDisableRequestedBy === myUserId) {
    body = (
      <>
        <p className="text-sm">You asked to turn the passcode off. Waiting for the others to agree.</p>
        <Button
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={() => act(async (token) => useConversationsStore.getState().upsert(await api.cancelDisableRequest(conversation.id, token)))}
        >
          {busy ? "Cancelling…" : "Cancel request"}
        </Button>
      </>
    );
  } else if (conversation.passcodeDisableRequestedBy) {
    body = (
      <>
        <p className="text-sm">
          <span className="font-semibold text-orbit-accent">@{requester?.user.username ?? "Someone"}</span> wants to turn the passcode off.
        </p>
        <Button
          size="sm"
          variant="primary"
          className="mt-2"
          disabled={busy}
          onClick={() =>
            act(async (token) => {
              const result = await api.requestDisablePasscode(conversation.id, token);
              useConversationsStore.getState().upsert(result.conversation);
            })
          }
        >
          {busy ? "Approving…" : "Agree and turn off"}
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-sm">
          Passcode protection is <Badge tone="accent">on</Badge>
        </p>
        <p className="mt-1 text-[11px] text-orbit-muted">Turning it off needs everyone in the chat to agree.</p>
        <Button
          size="sm"
          className="mt-2"
          disabled={busy}
          onClick={() =>
            act(async (token) => {
              const result = await api.requestDisablePasscode(conversation.id, token);
              useConversationsStore.getState().upsert(result.conversation);
            })
          }
        >
          {busy ? "Requesting…" : "Ask to turn off"}
        </Button>
      </>
    );
  }

  return (
    <Section title="Passcode protection">
      {body}
      {error && (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      )}
    </Section>
  );
}

function Members({ conversation, myUserId }: { conversation: Conversation; myUserId: string }) {
  const profiles = useProfilesStore((s) => s.byId);
  const isOwner = conversation.createdBy === myUserId;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (userId: string) => {
    const { user, token } = useAuthStore.getState();
    if (!user || !token) return;
    setBusyId(userId);
    setError(null);
    try {
      await removeGroupMember({ conversation, userId, me: user, token });
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove them.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section title={`Members (${conversation.members.length})`}>
      <ul className="-mx-1 max-h-56 overflow-y-auto">
        {conversation.members.map((member) => {
          const name = profiles[member.userId]?.displayName?.trim() || member.user.username;
          return (
            <li key={member.userId} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar name={name} src={profiles[member.userId]?.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {name}
                  {member.userId === myUserId && <span className="ml-1.5 text-[11px] font-normal text-orbit-muted">(you)</span>}
                </span>
                <span className="block truncate text-[11px] text-orbit-muted">@{member.user.username}</span>
              </span>
              {member.userId === conversation.createdBy && <Badge tone="accent">Owner</Badge>}
              {isOwner && member.userId !== myUserId &&
                (confirming === member.userId ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busyId === member.userId}>
                      Keep
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void remove(member.userId)} disabled={busyId === member.userId}>
                      {busyId === member.userId ? "Removing…" : "Remove"}
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(member.userId)} aria-label={`Remove ${name}`}>
                    Remove
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>
      {error && (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      )}
      <Button size="sm" className="mt-2" onClick={() => useDialogStore.getState().open({ kind: "addMembers", conversationId: conversation.id })}>
        Add people…
      </Button>
    </Section>
  );
}
