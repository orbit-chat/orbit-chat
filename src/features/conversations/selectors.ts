import type { UserProfile } from "../../lib/api";
import type { ChatMessage } from "../../stores/messagesStore";
import type { Conversation } from "./conversationsStore";

type Profiles = Record<string, UserProfile | undefined>;

/** The other person in a DM (null for groups or a DM whose partner left). */
export function dmPartner(conversation: Conversation, myUserId: string) {
  if (conversation.type !== "dm") return null;
  return conversation.members.find((m) => m.user.id !== myUserId)?.user ?? null;
}

function personName(user: { id: string; username: string }, profiles: Profiles) {
  return profiles[user.id]?.displayName?.trim() || user.username;
}

/**
 * List/header title. A custom name wins; DMs fall back to the partner's display name,
 * groups to their members ("Ada, Grace +2").
 */
export function conversationTitle(conversation: Conversation, myUserId: string, profiles: Profiles = {}) {
  const custom = conversation.name?.trim();
  if (custom) return custom;
  if (conversation.type === "dm") {
    const partner = dmPartner(conversation, myUserId);
    return partner ? personName(partner, profiles) : "Direct message";
  }
  const others = conversation.members.filter((m) => m.user.id !== myUserId).map((m) => personName(m.user, profiles));
  if (others.length === 0) return "Empty group";
  if (others.length <= 2) return others.join(", ");
  return `${others.slice(0, 2).join(", ")} +${others.length - 2}`;
}

/** Most recent message time, or when the conversation was created. Milliseconds. */
export function lastActivityAt(conversation: Conversation, messages: ChatMessage[] | undefined) {
  const last = messages?.length ? messages[messages.length - 1]!.createdAt : 0;
  return Math.max(last, new Date(conversation.createdAt).getTime() || 0);
}

export type ConversationLists = {
  /** Pinned first, then most recent; archived excluded. */
  active: Conversation[];
  dms: Conversation[];
  groups: Conversation[];
  archived: Conversation[];
};

export function buildConversationLists(params: {
  conversations: Conversation[];
  messagesByConversation: Record<string, ChatMessage[] | undefined>;
  pinnedIds: string[];
  archivedIds: string[];
}): ConversationLists {
  const pinned = new Set(params.pinnedIds);
  const archived = new Set(params.archivedIds);
  const activity = new Map(params.conversations.map((c) => [c.id, lastActivityAt(c, params.messagesByConversation[c.id])]));
  const byRecency = (a: Conversation, b: Conversation) => activity.get(b.id)! - activity.get(a.id)!;

  const active = params.conversations
    .filter((c) => !archived.has(c.id))
    .sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || byRecency(a, b));

  return {
    active,
    dms: active.filter((c) => c.type === "dm"),
    groups: active.filter((c) => c.type === "group"),
    archived: params.conversations.filter((c) => archived.has(c.id)).sort(byRecency)
  };
}

/** Case-insensitive match on title or any member's username. */
export function matchesFilter(conversation: Conversation, title: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return title.toLowerCase().includes(q) || conversation.members.some((m) => m.user.username.toLowerCase().includes(q));
}

/** Compact time for list rows: "now", "5m", "3h", then weekday within a week, then a date. */
export function formatListTime(timestampMs: number, now = Date.now()) {
  const diff = now - timestampMs;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  const date = new Date(timestampMs);
  if (diff < 7 * day) return date.toLocaleDateString(undefined, { weekday: "short" });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "2-digit", month: "short", day: "numeric" });
}

/** Sidebar preview. Message text stays encrypted at rest, so the list shows who sent it, not what. */
export function previewText(conversation: Conversation, messages: ChatMessage[] | undefined, myUserId: string, profiles: Profiles = {}) {
  const last = messages?.length ? messages[messages.length - 1]! : null;
  if (last) {
    const what = last.mediaIds?.length ? "sent an attachment" : "sent a message";
    if (last.senderId === myUserId) return `You ${what}`;
    // In a DM the title already names the sender.
    if (conversation.type === "dm") return what[0]!.toUpperCase() + what.slice(1);
    return `${profiles[last.senderId]?.displayName?.trim() || last.sender} ${what}`;
  }
  return conversation.type === "dm" ? "No messages yet" : `${conversation.members.length} members`;
}

export function totalUnread(conversations: Conversation[], unread: Record<string, number>, type?: Conversation["type"]) {
  return conversations.reduce((sum, c) => (type && c.type !== type ? sum : sum + (unread[c.id] ?? 0)), 0);
}
