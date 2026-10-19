import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, IconButton, Input, Popover, PopoverContent, PopoverTrigger, Tooltip, cn } from "../../ui";
import { PinIcon, SearchIcon } from "../../ui/icons";
import { useE2EEStore } from "../../stores/e2eeStore";
import { useMessagesStore, type ChatMessage } from "../../stores/messagesStore";
import { useProfilesStore } from "../../stores/profilesStore";
import { useChatUiStore } from "./chatUiStore";
import { useDecryptedStore } from "./decryptedStore";
import { searchableText } from "./envelope";
import { useHistory, useHistoryStore } from "./historyStore";
import { excerpt, searchMessages } from "./searchMessages";
import { togglePin } from "./socketActions";
import { messageTimestampFull } from "./timeline";
import { useDecryptedMessage } from "./useDecryptedMessage";

const EMPTY: ChatMessage[] = [];

function useSenderName() {
  const profiles = useProfilesStore((s) => s.byId);
  return useCallback((message: ChatMessage) => profiles[message.senderId]?.displayName?.trim() || message.sender, [profiles]);
}

/**
 * Pinned messages among those loaded on this device (the server has no "list pins"
 * endpoint). Portalled, so it sits above the timeline and owns its pointer events.
 */
export function PinnedPopover({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const messages = useMessagesStore((s) => s.byConversation[conversationId] ?? EMPTY);
  const pinned = useMemo(() => messages.filter((m) => m.isPinned).reverse(), [messages]);
  const senderName = useSenderName();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Pinned messages">
        <PopoverTrigger asChild>
          <Button size="sm" variant={open ? "secondary" : "ghost"} aria-label={`Pinned messages (${pinned.length})`}>
            <PinIcon className="h-3.5 w-3.5" />
            {pinned.length > 0 && <span className="text-xs">{pinned.length}</span>}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="flex w-[min(26rem,calc(100vw-2rem))] flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Pinned messages</h2>
          <span className="text-[11px] text-orbit-muted">{pinned.length}</span>
        </header>
        <ul className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5">
          {pinned.map((message) => (
            <li key={message.id} className="group/pin relative">
              <button
                type="button"
                onClick={() => {
                  useChatUiStore.getState().jumpTo(conversationId, message.id);
                  setOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2.5 pr-16 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orbit-accent/60"
              >
                <p className="truncate text-[11px] font-semibold text-orbit-accent">
                  {senderName(message)} · <span className="font-normal text-orbit-muted">{messageTimestampFull(message.createdAt)}</span>
                </p>
                <Snippet conversationId={conversationId} message={message} />
              </button>
              <Button
                size="sm"
                variant="ghost"
                className="absolute right-2 top-2 h-6 px-2 text-[11px] opacity-0 focus-visible:opacity-100 group-hover/pin:opacity-100"
                onClick={() => togglePin(conversationId, message.id)}
              >
                Unpin
              </Button>
            </li>
          ))}
        </ul>
        {pinned.length === 0 && (
          <p className="px-4 pb-6 pt-4 text-center text-xs text-orbit-muted">No pinned messages. Pin one from its "…" menu to keep it here.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Snippet({ conversationId, message }: { conversationId: string; message: ChatMessage }) {
  const decrypted = useDecryptedMessage(conversationId, message);
  const text = decrypted.status === "ok" ? searchableText(decrypted.envelope) || "Attachment" : decrypted.status === "failed" ? "Couldn't decrypt" : "Decrypting…";
  return <p className="mt-0.5 line-clamp-2 text-xs text-slate-300">{text}</p>;
}

/** Decrypts every loaded message once, so local search can see them. */
function useDecryptAll(conversationId: string, messages: ChatMessage[], active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { getConversationSecretKeyForVersion } = useE2EEStore.getState();
    const { byMessageId, ensure } = useDecryptedStore.getState();
    for (const message of messages) {
      if (byMessageId[message.id]?.status === "ok") continue;
      const key = getConversationSecretKeyForVersion(conversationId, message.keyVersion);
      if (key) void ensure(message, key);
    }
  }, [conversationId, messages, active]);
}

/** Search this chat (Ctrl/Cmd+F). Runs on this device over decrypted messages. */
export function SearchPopover({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const messages = useMessagesStore((s) => s.byConversation[conversationId] ?? EMPTY);
  const decrypted = useDecryptedStore((s) => s.byMessageId);
  const history = useHistory(conversationId);
  const senderName = useSenderName();
  useDecryptAll(conversationId, messages, open);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = useMemo(() => (open ? searchMessages({ messages, decrypted, query, senderName }) : []), [open, messages, decrypted, query, senderName]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content="Search (Ctrl+F)">
        <PopoverTrigger asChild>
          <IconButton label="Search messages" size="sm" variant={open ? "secondary" : "ghost"}>
            <SearchIcon />
          </IconButton>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="flex w-[min(28rem,calc(100vw-2rem))] flex-col">
        <div className="border-b border-white/10 p-2.5">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-orbit-muted" />
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this chat" aria-label="Search this chat" className="h-8 pl-8 text-[13px]" />
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-orbit-muted">
            Searches the {messages.length} messages on this device. Messages are encrypted, so the server can't search them.
          </p>
        </div>
        <ul className="max-h-[min(60vh,26rem)] overflow-y-auto p-1.5" aria-label="Search results">
          {hits.map((hit) => {
            const parts = excerpt(hit);
            return (
              <li key={hit.message.id}>
                <button
                  type="button"
                  onClick={() => {
                    useChatUiStore.getState().jumpTo(conversationId, hit.message.id);
                    setOpen(false);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orbit-accent/60"
                >
                  <p className="truncate text-[11px] font-semibold text-orbit-accent">
                    {senderName(hit.message)} · <span className="font-normal text-orbit-muted">{messageTimestampFull(hit.message.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-300">
                    {parts.before}
                    {parts.match && <mark className="rounded bg-orbit-accent/30 px-0.5 text-orbit-text">{parts.match}</mark>}
                    {parts.after}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
        {query.trim() && hits.length === 0 && <p className="px-4 pb-4 pt-2 text-center text-xs text-orbit-muted">No messages match "{query.trim()}".</p>}
        {history.hasOlder && (
          <div className={cn("border-t border-white/10 p-2 text-center", !query.trim() && "border-t-0")}>
            <Button size="sm" variant="ghost" disabled={history.loadingOlder} onClick={() => void useHistoryStore.getState().loadOlder(conversationId)}>
              {history.loadingOlder ? "Loading…" : "Load older messages to search further"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
