import { Fragment, useState } from "react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  cn
} from "../../ui";
import { MoreIcon, ReplyIcon, SmilePlusIcon } from "../../ui/icons";
import { ALL_REACTIONS, QUICK_REACTIONS, react, type MessageAction } from "./messageActions";

/**
 * Floating actions on a message. Visibility is pure CSS (`group-hover`/`focus-within`
 * on the row), never React state, so hovering one message re-renders nothing, and
 * anything covering the row — a portalled popover — blocks the hover like any element.
 * It stays visible while one of its own menus is open.
 */
export function MessageToolbar({
  conversationId,
  messageId,
  actions,
  mine
}: {
  conversationId: string;
  messageId: string;
  actions: MessageAction[];
  mine: boolean;
}) {
  const reply = actions.find((a) => a.id === "reply");
  return (
    <div
      data-message-toolbar=""
      className={cn(
        "pointer-events-none absolute -top-4 z-[1] flex items-center gap-0.5 rounded-full border border-white/10 bg-orbit-panelAlt px-1 py-0.5 opacity-0 shadow-lg transition-opacity duration-100",
        "group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100",
        "has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100",
        mine ? "right-12" : "left-12"
      )}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          tabIndex={-1}
          aria-label={`React ${emoji}`}
          onClick={() => react(conversationId, messageId, emoji)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[15px] transition-transform hover:scale-110 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
        >
          {emoji}
        </button>
      ))}
      <ReactionPickerButton conversationId={conversationId} messageId={messageId} />
      {reply && (
        <Tooltip content="Reply">
          <IconButton label="Reply" size="sm" tabIndex={-1} className="rounded-full" onClick={reply.onSelect}>
            <ReplyIcon className="h-3.5 w-3.5" />
          </IconButton>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="More actions" size="sm" tabIndex={-1} className="rounded-full">
            <MoreIcon className="h-3.5 w-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={mine ? "end" : "start"}>
          {actions.map((action) => (
            <Fragment key={action.id}>
              {action.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem icon={action.icon} onSelect={action.onSelect}>
                {action.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ReactionPickerButton({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Add reaction">
        <PopoverTrigger asChild>
          <IconButton label="Add reaction" size="sm" tabIndex={-1} className="rounded-full">
            <SmilePlusIcon className="h-3.5 w-3.5" />
          </IconButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" className="p-1.5">
        <ReactionGrid
          onPick={(emoji) => {
            react(conversationId, messageId, emoji);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ReactionGrid({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-5 gap-0.5" role="group" aria-label="Reactions">
      {ALL_REACTIONS.map((r) => (
        <Tooltip key={r.emoji} content={`:${r.name}:`}>
          <button
            type="button"
            aria-label={`React ${r.emoji}`}
            onClick={() => onPick(r.emoji)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-transform hover:scale-110 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orbit-accent/60"
          >
            {r.emoji}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** Right-click menu: quick reactions on top, then the same actions as "…". */
export function MessageContextMenuContent({ conversationId, messageId, actions }: { conversationId: string; messageId: string; actions: MessageAction[] }) {
  return (
    <ContextMenuContent>
      <div className="flex gap-0.5 px-1 pb-1 pt-0.5">
        {QUICK_REACTIONS.map((emoji) => (
          <ContextMenuItem key={emoji} className="h-8 w-8 justify-center px-0 text-base" onSelect={() => react(conversationId, messageId, emoji)} aria-label={`React ${emoji}`}>
            {emoji}
          </ContextMenuItem>
        ))}
      </div>
      <ContextMenuSeparator />
      {actions.map((action) => (
        <Fragment key={action.id}>
          {action.separatorBefore && <ContextMenuSeparator />}
          <ContextMenuItem icon={action.icon} onSelect={action.onSelect}>
            {action.label}
          </ContextMenuItem>
        </Fragment>
      ))}
    </ContextMenuContent>
  );
}
