import type { ChatMessage } from "../../stores/messagesStore";

/** Consecutive messages from one sender within this window share one header. */
export const GROUP_WINDOW_MS = 5 * 60_000;

export type TimelineItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "unread"; key: string; count: number }
  | { kind: "message"; key: string; message: ChatMessage; startsGroup: boolean };

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", a weekday within the last week, otherwise a full date. */
export function dayLabel(ts: number, now = Date.now()) {
  const startOf = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(now) - startOf(ts)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(ts);
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" })
  });
}

/**
 * Flattens messages (oldest first) into list rows: a separator at each new day, a
 * "new messages" marker before the first unread one, and a flag for where a sender's
 * group starts so only that row shows the avatar and name.
 */
export function buildTimeline(messages: ChatMessage[], options: { unreadCount?: number; myUserId?: string; now?: number } = {}): TimelineItem[] {
  const items: TimelineItem[] = [];
  const unread = Math.min(options.unreadCount ?? 0, messages.length);
  const firstUnreadIndex = unread > 0 ? messages.length - unread : -1;
  let previous: ChatMessage | null = null;

  messages.forEach((message, index) => {
    const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
    if (newDay) items.push({ kind: "day", key: `day:${dayKey(message.createdAt)}`, label: dayLabel(message.createdAt, options.now) });

    const isFirstUnread = index === firstUnreadIndex && message.senderId !== options.myUserId;
    if (isFirstUnread) items.push({ kind: "unread", key: "unread", count: unread });

    const startsGroup =
      newDay || isFirstUnread || !previous || previous.senderId !== message.senderId || message.createdAt - previous.createdAt > GROUP_WINDOW_MS;
    items.push({ kind: "message", key: message.id, message, startsGroup });
    previous = message;
  });

  return items;
}

/** Time shown on a message: just the time, since day separators carry the date. */
export function messageTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Full timestamp for tooltips. */
export function messageTimestampFull(ts: number) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
}
