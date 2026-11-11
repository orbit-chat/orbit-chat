import { useEffect, useMemo, useRef } from "react";
import { IconButton, Tooltip, cn } from "../../ui";
import { CloseIcon } from "../../ui/icons";
import { useMessagesStore, type ChatMessage } from "../../stores/messagesStore";
import type { Conversation } from "../conversations/conversationsStore";
import { Composer } from "../composer/Composer";
import { useChatUiStore } from "./chatUiStore";
import { MessageRow } from "./MessageRow";
import { GROUP_WINDOW_MS } from "./timeline";

const EMPTY: ChatMessage[] = [];

/**
 * A message and its replies beside the timeline, with its own composer (and its own
 * draft). Replies are ordinary messages with `parentMessageId` set, so they also appear
 * in the main timeline with a quote.
 */
export function ThreadPanel({
  conversation,
  rootId,
  me,
  minReadableKeyVersion,
  overlay = false
}: {
  conversation: Conversation;
  rootId: string;
  me: { id: string; username: string };
  minReadableKeyVersion: number;
  /** Phones: cover the chat instead of sitting beside it. */
  overlay?: boolean;
}) {
  const messages = useMessagesStore((s) => s.byConversation[conversation.id] ?? EMPTY);
  const root = messages.find((m) => m.id === rootId);
  const replies = useMemo(() => messages.filter((m) => m.parentMessageId === rootId), [messages, rootId]);
  const close = () => useChatUiStore.getState().closeThread(conversation.id);
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest reply in view as replies arrive.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [replies.length]);

  return (
    <aside
      aria-label="Thread"
      className={cn(
        "flex flex-col bg-orbit-sidebar",
        // Phones: the thread covers the chat, like a pushed screen.
        overlay ? "fixed inset-0 z-dialog pt-[env(safe-area-inset-top)]" : "w-[min(380px,40%)] min-w-[300px] shrink-0 border-l border-white/10"
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 pl-4 pr-2">
        <h2 className="flex-1 text-sm font-bold">Thread</h2>
        <span className="text-xs text-orbit-muted">
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </span>
        <Tooltip content="Close thread">
          <IconButton label="Close thread" size="sm" onClick={close}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {root ? (
          <>
            <MessageRow
              conversationId={conversation.id}
              message={root}
              startsGroup
              me={me}
              minReadableKeyVersion={minReadableKeyVersion}
              highlighted={false}
              onJumpTo={(id) => useChatUiStore.getState().jumpTo(conversation.id, id)}
              inThread
            />
            <div className="mx-4 my-3 flex items-center gap-2 text-[11px] text-orbit-muted">
              <span className="h-px flex-1 bg-white/[0.07]" />
              {replies.length ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "No replies yet"}
              <span className="h-px flex-1 bg-white/[0.07]" />
            </div>
            {replies.map((reply, i) => {
              const previous = replies[i - 1];
              const startsGroup = !previous || previous.senderId !== reply.senderId || reply.createdAt - previous.createdAt > GROUP_WINDOW_MS;
              return (
                <MessageRow
                  key={reply.id}
                  conversationId={conversation.id}
                  message={reply}
                  startsGroup={startsGroup}
                  me={me}
                  minReadableKeyVersion={minReadableKeyVersion}
                  highlighted={false}
                  onJumpTo={(id) => useChatUiStore.getState().jumpTo(conversation.id, id)}
                  inThread
                />
              );
            })}
            <div ref={endRef} />
          </>
        ) : (
          <p className="p-6 text-center text-xs text-orbit-muted">The original message isn't loaded on this device.</p>
        )}
      </div>

      <Composer conversation={conversation} me={me} title="thread" threadRootId={rootId} />
    </aside>
  );
}
