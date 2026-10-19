import { memo } from "react";
import { Avatar, Tooltip, cn } from "../../ui";
import { PinIcon, ReplyIcon } from "../../ui/icons";
import type { ChatMessage } from "../../stores/messagesStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { searchableText } from "./envelope";
import { MessageBody } from "./MessageBody";
import { mentionsUser } from "./MessageText";
import { messageTime, messageTimestampFull } from "./timeline";
import { useDecryptedMessage } from "./useDecryptedMessage";

type MessageRowProps = {
  conversationId: string;
  message: ChatMessage;
  startsGroup: boolean;
  me: { id: string; username: string };
  minReadableKeyVersion: number;
  highlighted: boolean;
  onJumpTo: (messageId: string) => void;
};

/**
 * One message. Mine sit on the right with the accent tint; a sender's follow-ups within
 * a few minutes drop the avatar and name. Hover/actions arrive in Phase 5 as pure CSS.
 */
export const MessageRow = memo(function MessageRow({
  conversationId,
  message,
  startsGroup,
  me,
  minReadableKeyVersion,
  highlighted,
  onJumpTo
}: MessageRowProps) {
  const mine = message.senderId === me.id;
  const profile = useProfilesStore((s) => s.byId[message.senderId]);
  const name = profile?.displayName?.trim() || message.sender;
  const decrypted = useDecryptedMessage(conversationId, message);
  const unreadableVersion = typeof message.keyVersion === "number" && message.keyVersion < minReadableKeyVersion;
  const pingsMe = !mine && decrypted.status === "ok" && mentionsUser(decrypted.envelope.text, me.username);
  const reactions = message.reactions ?? [];

  return (
    <div
      data-message-id={message.id}
      className={cn("group/msg px-4", startsGroup ? "pt-3" : "pt-0.5")}
    >
      <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
        <div className="w-9 shrink-0">
          {startsGroup && !mine && <Avatar name={name} src={profile?.avatarUrl} size="md" />}
        </div>

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

          {message.parentMessageId && <ReplyQuote conversationId={conversationId} parentId={message.parentMessageId} onJumpTo={onJumpTo} mine={mine} />}

          <div
            className={cn(
              "relative min-w-0 rounded-2xl border px-3 py-2 text-[13.5px] leading-relaxed text-orbit-text transition-shadow duration-300",
              mine ? "border-orbit-accent/20 bg-orbit-accent/15" : pingsMe ? "border-orbit-warning/40 bg-orbit-warning/10" : "border-white/[0.06] bg-orbit-bubble",
              mine ? (startsGroup ? "rounded-tr-md" : "rounded-r-md") : startsGroup ? "rounded-tl-md" : "rounded-l-md",
              highlighted && "ring-2 ring-orbit-accent/70"
            )}
          >
            <MessageBody
              conversationId={conversationId}
              message={message}
              decrypted={decrypted}
              myUsername={me.username}
              unreadableVersion={unreadableVersion}
            />
            {message.isPinned && (
              <PinIcon className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-orbit-raised p-0.5 text-orbit-accent" aria-label="Pinned" />
            )}
          </div>

          {reactions.length > 0 && (
            <ul className={cn("mt-1 flex flex-wrap gap-1", mine && "justify-end")} aria-label="Reactions">
              {reactions.map((reaction) => {
                const reacted = reaction.userIds.includes(me.id);
                return (
                  <li
                    key={reaction.emoji}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
                      reacted ? "border-orbit-accent/50 bg-orbit-accent/15 text-orbit-text" : "border-white/10 bg-white/[0.04] text-orbit-muted"
                    )}
                    aria-label={`${reaction.emoji} ${reaction.count}${reacted ? ", including you" : ""}`}
                  >
                    <span>{reaction.emoji}</span>
                    <span className="text-[10px] font-semibold">{reaction.count}</span>
                  </li>
                );
              })}
            </ul>
          )}
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
      </div>
    </div>
  );
});

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
