import type { NotificationPrefs } from "../../stores/prefsStore";
import type { Conversation } from "../conversations/conversationsStore";
import type { MessageEnvelope } from "../chat/envelope";
import { mentionsUser } from "../chat/MessageText";

export type IncomingMessage = { id: string; conversationId: string; senderId: string; sender: string };

/**
 * Whether a new message should raise a desktop notification. Never for your own messages,
 * muted chats, or the chat you're looking at in a focused window.
 */
export function shouldNotify(params: {
  message: IncomingMessage;
  myUserId: string;
  myUsername: string;
  prefs: NotificationPrefs;
  muted: boolean;
  windowFocused: boolean;
  openConversationId: string | null;
  /** Decrypted envelope, if available; needed for "mentions only". */
  envelope: MessageEnvelope | null;
}): boolean {
  const { message, prefs } = params;
  if (message.senderId === params.myUserId) return false;
  if (prefs.mode === "off" || params.muted) return false;
  if (params.windowFocused && params.openConversationId === message.conversationId) return false;
  if (prefs.mode === "mentions") return Boolean(params.envelope && mentionsUser(params.envelope.text, params.myUsername));
  return true;
}

/**
 * Title and body. Message text only appears if previews are on and the chat isn't
 * passcode-protected (a lock screen shouldn't leak through the notification centre).
 */
export function notificationContent(params: {
  message: IncomingMessage;
  conversation: Conversation | undefined;
  senderName: string;
  conversationTitle: string;
  prefs: NotificationPrefs;
  envelope: MessageEnvelope | null;
}) {
  const { conversation, senderName, envelope } = params;
  const title = conversation?.type === "group" ? `${senderName} in ${params.conversationTitle}` : senderName;
  if (conversation?.passcodeEnabled) return { title, body: "New message in a locked chat" };
  if (!params.prefs.showPreview || !envelope) return { title, body: "New message" };
  const text = envelope.text.trim();
  if (text) return { title, body: text.length > 140 ? `${text.slice(0, 139)}…` : text };
  const first = envelope.attachments[0];
  if (!first) return { title, body: "New message" };
  return { title, body: first.kind === "gif_link" ? "Sent a GIF" : first.kind === "image" ? "Sent an image" : `Sent ${first.name}` };
}

/** "(3) Orbit Chat" while there are unread messages in chats that aren't muted. */
export function windowTitle(unreadByConversation: Record<string, number>, mutedIds: string[], base = "Orbit Chat") {
  const muted = new Set(mutedIds);
  const total = Object.entries(unreadByConversation).reduce((sum, [id, n]) => (muted.has(id) ? sum : sum + (n || 0)), 0);
  return total > 0 ? `(${total > 99 ? "99+" : total}) ${base}` : base;
}
