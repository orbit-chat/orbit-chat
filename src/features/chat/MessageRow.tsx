import { memo } from "react";
import { Avatar, Button, ContextMenu, ContextMenuTrigger, Tooltip, cn } from "../../ui";
import { CheckIcon, PinIcon, ReplyIcon, ThreadIcon } from "../../ui/icons";
import type { ChatMessage } from "../../stores/messagesStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useOutboxStore, type OutboxEntry } from "../composer/outboxStore";
import { useChatUiStore } from "./chatUiStore";
import { searchableText } from "./envelope";
import { buildMessageActions, react } from "./messageActions";
import { MessageBody } from "./MessageBody";
import { MessageContextMenuContent, MessageToolbar } from "./MessageToolbar";
import { mentionsUser } from "./MessageText";
import { usePresenceStore } from "./presenceStore";
import { messageTime, messageTimestampFull } from "./timeline";
import { useDecryptedMessage, type DecryptState } from "./useDecryptedMessage";

const NO_ONE: string[] = [];

type MessageRowProps = {
  conversationId: string;
  message: ChatMessage;
  startsGroup: boolean;
  me: { id: string; username: string };
  minReadableKeyVersion: number;
  highlighted: boolean;
  onJumpTo: (messageId: string) => void;
  /** Set for a message still in the outbox (not yet confirmed by the server). */
  pending?: OutboxEntry;
  /** Replies to this message (shown as "N replies" when it's a thread root). */
  replyCount?: number;
  /** Your most recent message: shows who has seen it. */
  showSeen?: boolean;
  /** Rendered inside the thread panel: no thread link, replies go to the thread's draft. */
  inThread?: boolean;
};

/**
 * One message. Mine sit on the right with the accent tint; a sender's follow-ups within
 * a few minutes drop the avatar and name. Hover shows a toolbar (CSS only) and
 * right-click opens the same actions.
 */
export const MessageRow = memo(function MessageRow({
  conversationId,
  message,
  startsGroup,
  me,
  minReadableKeyVersion,
  highlighted,
  onJumpTo,
  pending,
  replyCount = 0,
  showSeen = false,
  inThread = false
}: MessageRowProps) {
  const mine = message.senderId === me.id;
  const profile = useProfilesStore((s) => s.byId[message.senderId]);
  const name = profile?.displayName?.trim() || message.sender;
  const fetched = useDecryptedMessage(conversationId, message, !pending);
  const decrypted: DecryptState = pending ? { status: "ok", envelope: pending.envelope } : fetched;
  const unreadableVersion = typeof message.keyVersion === "number" && message.keyVersion < minReadableKeyVersion;
  const pingsMe = !mine && decrypted.status === "ok" && mentionsUser(decrypted.envelope.text, me.username);
  const reactions = message.reactions ?? [];
  const interactive = !pending;
  const actions = interactive ? buildMessageActions({ conversationId, message, decrypted, senderName: name, mine, inThread }) : [];

  const row = (
    <div className={cn("relative flex items-end gap-2", mine && "flex-row-reverse")}>
      <div className="w-9 shrink-0">{startsGroup && !mine && <Avatar name={name} src={profile?.avatarUrl} size="md" />}</div>

      <div className={cn("flex min-w-0 max-w-[min(75%,42rem)] flex-col", mine ? "items-end" : "items-start")}>
        {startsGroup && (
          <div className={cn("mb-1 flex items-baseline gap-2 px-1", mine && "flex-row-reverse")}>
            {!mine && <span className="truncate text-xs font-semibold text-orbit-accent">{name}</span>}
            <Tooltip content={messageTimestampFull(message.createdAt)}>
              <time dateTime={new Date(message.createdAt).toISOString()} className="text-[10px] text-orbit-muted">
                {messageTime(message.createdAt)}
              </time>
            </Tooltip>
          </div>
        )}

        {message.parentMessageId && !inThread && (
          <ReplyQuote conversationId={conversationId} parentId={message.parentMessageId} onJumpTo={onJumpTo} mine={mine} />
        )}

        <div
          className={cn(
            "relative min-w-0 rounded-2xl border px-3 py-2 text-[13.5px] leading-relaxed text-orbit-text transition-shadow duration-300",
            mine ? "border-orbit-accent/20 bg-orbit-accent/15" : pingsMe ? "border-orbit-warning/40 bg-orbit-warning/10" : "border-white/[0.06] bg-orbit-bubble",
            mine ? (startsGroup ? "rounded-tr-md" : "rounded-r-md") : startsGroup ? "rounded-tl-md" : "rounded-l-md",
            highlighted && "ring-2 ring-orbit-accent/70",
            pending && pending.status !== "failed" && "opacity-70",
            pending?.status === "failed" && "border-orbit-danger/50"
          )}
        >
          <MessageBody conversationId={conversationId} message={message} decrypted={decrypted} myUsername={me.username} unreadableVersion={unreadableVersion} />
          {message.isPinned && (
            <PinIcon className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-orbit-raised p-0.5 text-orbit-accent" aria-label="Pinned" />
          )}
        </div>

        {pending && <PendingStatus entry={pending} />}

        {reactions.length > 0 && <Reactions conversationId={conversationId} messageId={message.id} reactions={reactions} myUserId={me.id} mine={mine} />}

        {replyCount > 0 && !inThread && (
          <button
            type="button"
            onClick={() => useChatUiStore.getState().openThread(conversationId, message.id)}
            className="mt-1 flex items-center gap-1 rounded-md px-1 text-[11px] font-semibold text-orbit-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
          >
            <ThreadIcon className="h-3 w-3" />
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </button>
        )}

        {showSeen && <SeenBy messageId={message.id} />}
      </div>

      {/* Follow-up messages show their time on hover, beside the bubble. */}
      {!startsGroup && (
        <time
          dateTime={new Date(message.createdAt).toISOString()}
          className="mb-2 shrink-0 text-[10px] text-orbit-muted opacity-0 transition-opacity group-hover/msg:opacity-100"
        >
          {messageTime(message.createdAt)}
        </time>
      )}

      {interactive && <MessageToolbar conversationId={conversationId} messageId={message.id} actions={actions} mine={mine} />}
    </div>
  );

  return (
    <div data-message-id={message.id} className={cn("group/msg px-4", startsGroup ? "pt-3" : "pt-0.5")}>
      {interactive ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <MessageContextMenuContent conversationId={conversationId} messageId={message.id} actions={actions} />
        </ContextMenu>
      ) : (
        row
      )}
    </div>
  );
});

/** Reaction chips: click to toggle yours; hover to see who reacted. */
function Reactions({
  conversationId,
  messageId,
  reactions,
  myUserId,
  mine
}: {
  conversationId: string;
  messageId: string;
  reactions: NonNullable<ChatMessage["reactions"]>;
  myUserId: string;
  mine: boolean;
}) {
  const profiles = useProfilesStore((s) => s.byId);
  const nameOf = (id: string) => (id === myUserId ? "You" : profiles[id]?.displayName?.trim() || profiles[id]?.username || "Someone");
  return (
    <ul className={cn("mt-1 flex flex-wrap gap-1", mine && "justify-end")} aria-label="Reactions">
      {reactions.map((reaction) => {
        const reacted = reaction.userIds.includes(myUserId);
        const who = reaction.userIds.map(nameOf).join(", ");
        return (
          <li key={reaction.emoji}>
            <Tooltip content={who || `${reaction.count} reaction${reaction.count === 1 ? "" : "s"}`}>
              <button
                type="button"
                onClick={() => react(conversationId, messageId, reaction.emoji)}
                aria-pressed={reacted}
                aria-label={`${reaction.emoji} ${reaction.count}${reacted ? ", including you" : ""}. ${reacted ? "Remove" : "Add"} reaction`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
                  reacted
                    ? "border-orbit-accent/50 bg-orbit-accent/15 text-orbit-text hover:bg-orbit-accent/25"
                    : "border-white/10 bg-white/[0.04] text-orbit-muted hover:border-white/20 hover:text-orbit-text"
                )}
              >
                <span>{reaction.emoji}</span>
                <span className="text-[10px] font-semibold">{reaction.count}</span>
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** "Seen by Ada, Grace" under your latest message, from live receipts. */
function SeenBy({ messageId }: { messageId: string }) {
  const seenBy = usePresenceStore((s) => s.seenByMessage[messageId] ?? NO_ONE);
  const profiles = useProfilesStore((s) => s.byId);
  if (!seenBy.length) return null;
  const names = seenBy.map((id) => profiles[id]?.displayName?.trim() || profiles[id]?.username || "someone");
  const label = names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
  return (
    <p className="mt-1 flex items-center gap-1 px-1 text-[10px] text-orbit-muted">
      <CheckIcon className="h-3 w-3 text-orbit-accent" /> Seen by {label}
    </p>
  );
}

/** Under a message that hasn't been confirmed: what's happening, or why it failed. */
function PendingStatus({ entry }: { entry: OutboxEntry }) {
  if (entry.status === "failed") {
    return (
      <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-[11px]" role="alert">
        <span className="text-rose-300">{entry.error ?? "Not sent."}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-orbit-accent" onClick={() => void useOutboxStore.getState().retry(entry.localId)}>
          Retry
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => useOutboxStore.getState().discard(entry.localId)}>
          Discard
        </Button>
      </div>
    );
  }
  const uploading = entry.files.length === 1 ? entry.files[0]!.name : `${entry.files.length} files`;
  const label = entry.status === "sending" ? "Sending…" : entry.files.length ? `Encrypting and uploading ${uploading}…` : "Encrypting…";
  return (
    <p className="mt-1 text-[11px] text-orbit-muted" role="status">
      {label}
    </p>
  );
}

/** "Replying to …" above a reply; jumps to the original when clicked. */
function ReplyQuote({ conversationId, parentId, onJumpTo, mine }: { conversationId: string; parentId: string; onJumpTo: (id: string) => void; mine: boolean }) {
  const parent = useMessagesStore((s) => s.byConversation[conversationId]?.find((m) => m.id === parentId));
  const profile = useProfilesStore((s) => (parent ? s.byId[parent.senderId] : undefined));

  if (!parent) {
    return (
      <p className={cn("mb-1 flex items-center gap-1 px-1 text-[11px] italic text-orbit-muted", mine && "flex-row-reverse")}>
        <ReplyIcon className="h-3 w-3" /> Reply to an earlier message
      </p>
    );
  }
  return <ReplyQuoteLoaded conversationId={conversationId} parent={parent} name={profile?.displayName?.trim() || parent.sender} onJumpTo={onJumpTo} mine={mine} />;
}

function ReplyQuoteLoaded({
  conversationId,
  parent,
  name,
  onJumpTo,
  mine
}: {
  conversationId: string;
  parent: ChatMessage;
  name: string;
  onJumpTo: (id: string) => void;
  mine: boolean;
}) {
  const decrypted = useDecryptedMessage(conversationId, parent);
  const snippet = decrypted.status === "ok" ? searchableText(decrypted.envelope) || "Attachment" : "Encrypted message";
  return (
    <button
      type="button"
      onClick={() => onJumpTo(parent.id)}
      className={cn(
        "mb-1 flex max-w-full items-center gap-1.5 rounded-lg border-l-2 border-orbit-accent/60 bg-white/[0.04] px-2 py-1 text-left text-[11px] text-orbit-muted hover:bg-white/[0.07] hover:text-orbit-text",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
        mine && "self-end"
      )}
    >
      <ReplyIcon className="h-3 w-3 shrink-0" />
      <span className="shrink-0 font-semibold text-orbit-accent">{name}</span>
      <span className="truncate">{snippet}</span>
    </button>
  );
}
