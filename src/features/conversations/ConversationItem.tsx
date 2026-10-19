import { Fragment, memo } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  CountBadge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn
} from "../../ui";
import { BellOffIcon, LockIcon, MoreIcon, PinIcon } from "../../ui/icons";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useUserPrefs } from "../../stores/prefsStore";
import { ConversationAvatar } from "./ConversationAvatar";
import { useConversationActions } from "./conversationActions";
import type { Conversation } from "./conversationsStore";
import { conversationTitle, formatListTime, lastActivityAt, previewText } from "./selectors";

type ConversationItemProps = {
  conversation: Conversation;
  myUserId: string;
  selected: boolean;
  pinned: boolean;
  onOpen: (conversation: Conversation) => void;
};

/**
 * One row in the sidebar. Subscribes only to its own messages and unread count, so a new
 * message re-renders the affected row instead of the whole list.
 */
export const ConversationItem = memo(function ConversationItem({ conversation, myUserId, selected, pinned, onOpen }: ConversationItemProps) {
  const messages = useMessagesStore((s) => s.byConversation[conversation.id]);
  const unread = useMessagesStore((s) => (selected ? 0 : s.unreadCountByConversation[conversation.id] ?? 0));
  const locked = useChatLockStore((s) => conversation.passcodeEnabled && !s.unlocked[conversation.id]);
  const profiles = useProfilesStore((s) => s.byId);
  const title = conversationTitle(conversation, myUserId, profiles);
  const actions = useConversationActions(conversation);
  const muted = useUserPrefs().mutedConversationIds.includes(conversation.id);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group/item relative" data-conversation-row="">
          <button
            type="button"
            onClick={() => onOpen(conversation)}
            aria-current={selected ? "true" : undefined}
            aria-label={`${title}${unread ? `, ${unread} unread` : ""}${locked ? ", locked" : ""}${muted ? ", muted" : ""}`}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-100",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orbit-accent/60",
              selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
            )}
          >
            <ConversationAvatar conversation={conversation} myUserId={myUserId} title={title} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className={cn("truncate text-[13px]", unread ? "font-bold text-orbit-text" : "font-semibold text-slate-200")}>{title}</span>
                {locked && <LockIcon className="h-3 w-3 shrink-0 text-orbit-muted" aria-hidden="true" />}
                {pinned && <PinIcon className="h-3 w-3 shrink-0 text-orbit-accent/80" aria-hidden="true" />}
                {muted && <BellOffIcon className="h-3 w-3 shrink-0 text-orbit-muted" aria-hidden="true" />}
                <span className="ml-auto shrink-0 pl-1 text-[10px] text-orbit-muted transition-opacity group-hover/item:opacity-0">
                  {formatListTime(lastActivityAt(conversation, messages))}
                </span>
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className={cn("min-w-0 flex-1 truncate text-xs", unread ? "text-slate-300" : "text-orbit-muted")}>
                  {locked ? "Locked chat" : previewText(conversation, messages, myUserId, profiles)}
                </span>
                <CountBadge count={unread} className={muted ? "bg-white/20 text-orbit-text" : undefined} />
              </span>
            </span>
          </button>

          {/* Hover/focus "…" menu, the discoverable twin of the right-click menu. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`More actions for ${title}`}
              className={cn(
                "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-orbit-muted opacity-0 transition-opacity",
                "hover:bg-white/10 hover:text-orbit-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60",
                "group-hover/item:opacity-100 data-[state=open]:opacity-100"
              )}
            >
              <MoreIcon className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.map((action) => (
                <Fragment key={action.id}>
                  {action.separatorBefore && <DropdownMenuSeparator />}
                  <DropdownMenuItem icon={action.icon} danger={action.danger} onSelect={action.onSelect}>
                    {action.label}
                  </DropdownMenuItem>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {actions.map((action) => (
          <Fragment key={action.id}>
            {action.separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem icon={action.icon} danger={action.danger} onSelect={action.onSelect}>
              {action.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});
