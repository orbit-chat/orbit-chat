import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, cn } from "../../ui";
import { useMessagesStore, type ChatMessage } from "../../stores/messagesStore";
import { useOutboxStore, type OutboxEntry } from "../composer/outboxStore";
import { useChatUiStore } from "./chatUiStore";
import { useHistory, useHistoryStore } from "./historyStore";
import { MessageRow } from "./MessageRow";
import { buildTimeline, type TimelineItem } from "./timeline";
import { useProfilesStore } from "../../stores/profilesStore";
import { preferredScrollBehavior } from "../../ui/motion";

/** Within this distance of the bottom counts as "reading the latest". */
const BOTTOM_THRESHOLD = 96;
/** Start fetching older history this close to the top. */
const TOP_THRESHOLD = 240;
const HIGHLIGHT_MS = 2400;
const EMPTY: ChatMessage[] = [];

type MessageListProps = {
  conversationId: string;
  me: { id: string; username: string };
  minReadableKeyVersion: number;
  /** Unread count when the chat was opened; places the "New messages" marker. */
  unreadAtOpen: number;
};

/**
 * Virtualized timeline: only rows near the viewport are mounted, so long histories stay
 * smooth. Opens at the first unread message (or the bottom), follows new messages while
 * you're at the bottom, offers "Jump to latest" when you aren't, and loads older pages
 * as you scroll up without the view jumping.
 */
export function MessageList({ conversationId, me, minReadableKeyVersion, unreadAtOpen }: MessageListProps) {
  const stored = useMessagesStore((s) => s.byConversation[conversationId] ?? EMPTY);
  const outbox = useOutboxStore((s) => s.entries);
  const history = useHistory(conversationId);

  // Messages you sent that the server hasn't echoed yet go after everything else.
  const { messages, pendingById } = useMemo(() => {
    const pending = outbox.filter((e) => e.conversationId === conversationId);
    if (!pending.length) return { messages: stored, pendingById: new Map<string, OutboxEntry>() };
    const asMessages: ChatMessage[] = pending.map((e) => ({
      id: e.localId,
      senderId: me.id,
      sender: me.username,
      parentMessageId: e.parentMessageId,
      cipherText: "",
      createdAt: Math.max(e.createdAt, stored.at(-1)?.createdAt ?? 0)
    }));
    return { messages: [...stored, ...asMessages], pendingById: new Map(pending.map((e) => [e.localId, e])) };
  }, [stored, outbox, conversationId, me.id, me.username]);

  const items = useMemo(() => buildTimeline(messages, { unreadCount: unreadAtOpen, myUserId: me.id }), [messages, unreadAtOpen, me.id]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [missedWhileAway, setMissedWhileAway] = useState(0);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const atBottomRef = useRef(true);
  const anchorRef = useRef<{ key: string; delta: number } | null>(null);
  const initialScrollDone = useRef(false);
  const lastMessageIdRef = useRef<string | null>(messages.at(-1)?.id ?? null);
  /** The one message in the tab order (roving tabindex); defaults to the newest. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Messages that arrived while the chat was open; they rise in once (history doesn't). */
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateHeight(items[index]),
    getItemKey: (index) => items[index]!.key,
    overscan: 10,
    // jsdom and the first paint have no layout yet.
    initialRect: { width: 800, height: 600 },
    paddingEnd: 12
  });

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      if (items.length) virtualizer.scrollToIndex(items.length - 1, { align: "end", behavior });
    },
    [items.length, virtualizer]
  );

  // First paint with content: open at the unread marker, else the bottom.
  useLayoutEffect(() => {
    if (initialScrollDone.current || items.length === 0) return;
    initialScrollDone.current = true;
    const unreadIndex = items.findIndex((item) => item.kind === "unread");
    if (unreadIndex > 0) virtualizer.scrollToIndex(unreadIndex, { align: "start" });
    else scrollToBottom();
  }, [items, virtualizer, scrollToBottom]);

  // New message at the end: follow it if you're at the bottom or you sent it; otherwise count it.
  useEffect(() => {
    const last = messages.at(-1);
    if (!last || last.id === lastMessageIdRef.current) return;
    const previousLast = lastMessageIdRef.current;
    lastMessageIdRef.current = last.id;
    // Older pages prepend; only a change of the newest message counts as "new".
    if (previousLast && messages.findIndex((m) => m.id === previousLast) === -1) return;
    setFreshIds((current) => new Set(current).add(last.id));
    window.setTimeout(() => setFreshIds((current) => {
      const next = new Set(current);
      next.delete(last.id);
      return next;
    }), 1000);
    if (last.senderId !== me.id) {
      const name = useProfilesStore.getState().byId[last.senderId]?.displayName?.trim() || last.sender;
      setAnnouncement(`New message from ${name}`);
    }
    if (atBottomRef.current || last.senderId === me.id) {
      requestAnimationFrame(() => scrollToBottom(preferredScrollBehavior()));
    } else {
      setMissedWhileAway((n) => n + 1);
    }
  }, [messages, me.id, scrollToBottom]);

  // Stay pinned to the bottom while rows below finish measuring (images, decryption).
  const totalSize = virtualizer.getTotalSize();
  useEffect(() => {
    if (atBottomRef.current && initialScrollDone.current && !anchorRef.current) scrollToBottom();
  }, [totalSize, scrollToBottom]);

  // After older history is prepended, put the row that was at the top back where it was.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || history.loadingOlder) return;
    anchorRef.current = null;
    const index = items.findIndex((item) => item.key === anchor.key);
    if (index < 0) return;
    const [offset] = virtualizer.getOffsetForIndex(index, "start") ?? [0];
    virtualizer.scrollToOffset(offset - anchor.delta);
  }, [items, history.loadingOlder, virtualizer]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setMissedWhileAway(0);

    if (el.scrollTop < TOP_THRESHOLD && history.hasOlder && !history.loadingOlder && initialScrollDone.current && messages.length) {
      const firstVisible = virtualizer.getVirtualItems().find((v) => v.end > el.scrollTop);
      if (firstVisible) anchorRef.current = { key: String(firstVisible.key), delta: firstVisible.start - el.scrollTop };
      void useHistoryStore.getState().loadOlder(conversationId);
    }
  };

  const jumpTo = useCallback(
    (messageId: string) => {
      const index = items.findIndex((item) => item.kind === "message" && item.message.id === messageId);
      if (index < 0) return;
      virtualizer.scrollToIndex(index, { align: "center", behavior: preferredScrollBehavior() });
      setHighlightedId(messageId);
    },
    [items, virtualizer]
  );

  useEffect(() => {
    if (!highlightedId) return;
    const timer = window.setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightedId]);

  // Jumps asked for from elsewhere (search results, pinned messages, the thread panel).
  const jumpRequest = useChatUiStore((s) => (s.jumpRequest?.conversationId === conversationId ? s.jumpRequest : null));
  useEffect(() => {
    if (jumpRequest) jumpTo(jumpRequest.messageId);
    // Only a new request should jump, not a re-render with the same one.
  }, [jumpRequest?.seq]);

  const replyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of stored) if (m.parentMessageId) counts.set(m.parentMessageId, (counts.get(m.parentMessageId) ?? 0) + 1);
    return counts;
  }, [stored]);
  const myLatestId = useMemo(() => {
    for (let i = stored.length - 1; i >= 0; i--) if (stored[i]!.senderId === me.id) return stored[i]!.id;
    return null;
  }, [stored, me.id]);

  const messageIndexes = useMemo(() => items.flatMap((item, i) => (item.kind === "message" ? [i] : [])), [items]);
  const focusedId = activeId ?? (messageIndexes.length ? (items[messageIndexes.at(-1)!] as Extract<TimelineItem, { kind: "message" }>).message.id : null);

  /** Up/Down/Home/End/PageUp/PageDown move between messages; Escape goes back to the composer. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-message-id]");
    if (!row || row !== event.target) return;
    if (event.key === "Escape") {
      event.preventDefault();
      document.querySelector<HTMLTextAreaElement>("textarea[data-main-composer]")?.focus();
      return;
    }
    const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
    const current = messageIndexes.findIndex((i) => (items[i] as Extract<TimelineItem, { kind: "message" }>).message.id === row.dataset.messageId);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = messageIndexes.length - 1;
    else if (event.key in steps) next = Math.max(0, Math.min(messageIndexes.length - 1, current + steps[event.key]!));
    else return;
    event.preventDefault();
    const itemIndex = messageIndexes[next]!;
    const id = (items[itemIndex] as Extract<TimelineItem, { kind: "message" }>).message.id;
    setActiveId(id);
    virtualizer.scrollToIndex(itemIndex, { align: "auto" });
    // The row may only mount after scrolling; focus it on the next frame.
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)?.focus());
  };

  const showEmpty = items.length === 0 && !history.loadingLatest;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
        role="log"
        aria-label="Messages"
        aria-live="off"
        onKeyDown={onKeyDown}
      >
        {history.loadingOlder && <p className="py-3 text-center text-[11px] text-orbit-muted">Loading older messages…</p>}
        {!history.hasOlder && messages.length > 0 && (
          <p className="pb-2 pt-6 text-center text-[11px] text-orbit-muted">This is the start of the conversation.</p>
        )}

        {history.loadingLatest && items.length === 0 && <TimelineSkeleton />}
        {showEmpty && (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm font-semibold">No messages yet</p>
              <p className="mt-1 text-xs text-orbit-muted">Say hello. Everything you send is encrypted on this device first.</p>
            </div>
          </div>
        )}

        <div className="relative w-full" style={{ height: totalSize }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index]!;
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {item.kind === "day" && <DaySeparator label={item.label} />}
                {item.kind === "unread" && <UnreadMarker />}
                {item.kind === "message" && (
                  <MessageRow
                    conversationId={conversationId}
                    message={item.message}
                    startsGroup={item.startsGroup}
                    me={me}
                    minReadableKeyVersion={minReadableKeyVersion}
                    highlighted={highlightedId === item.message.id}
                    onJumpTo={jumpTo}
                    pending={pendingById.get(item.message.id)}
                    focusable={item.message.id === focusedId}
                    fresh={freshIds.has(item.message.id)}
                    onFocusRow={setActiveId}
                    replyCount={replyCounts.get(item.message.id)}
                    showSeen={item.message.id === myLatestId}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {history.error && (
        <div className="absolute inset-x-0 top-2 flex justify-center">
          <span className="rounded-full border border-orbit-danger/30 bg-orbit-dialog px-3 py-1 text-[11px] text-rose-300 shadow-lg">{history.error}</span>
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-3 flex justify-center transition-all duration-200",
          atBottom ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"
        )}
      >
        <Button
          size="sm"
          variant={missedWhileAway ? "primary" : "secondary"}
          className={cn("shadow-lg", !atBottom && "pointer-events-auto")}
          tabIndex={atBottom ? -1 : 0}
          aria-hidden={atBottom}
          onClick={() => {
            scrollToBottom(preferredScrollBehavior());
            setMissedWhileAway(0);
          }}
        >
          {missedWhileAway ? `${missedWhileAway} new message${missedWhileAway === 1 ? "" : "s"}` : "Jump to latest"} ↓
        </Button>
      </div>
    </div>
  );
}

function estimateHeight(item: TimelineItem | undefined) {
  if (!item) return 40;
  if (item.kind === "day") return 44;
  if (item.kind === "unread") return 32;
  return item.startsGroup ? 72 : 44;
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 pb-1 pt-5" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-white/[0.07]" />
      <span className="text-[11px] font-semibold text-orbit-muted">{label}</span>
      <span className="h-px flex-1 bg-white/[0.07]" />
    </div>
  );
}

function UnreadMarker() {
  return (
    <div className="flex items-center gap-3 px-4 pt-3" role="separator" aria-label="New messages">
      <span className="h-px flex-1 bg-orbit-danger/50" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-orbit-danger">New messages</span>
      <span className="h-px flex-1 bg-orbit-danger/50" />
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4 p-4" role="status" aria-label="Loading messages">
      {[48, 64, 36, 56, 44].map((width, i) => (
        <div key={i} className={cn("flex items-end gap-2", i % 3 === 1 && "flex-row-reverse")}>
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />
          <span className="h-10 animate-pulse rounded-2xl bg-white/[0.06]" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}
