import type { ReactNode } from "react";
import { AtIcon, CopyIcon, PinIcon, ReplyIcon, ThreadIcon } from "../../ui/icons";
import type { ChatMessage } from "../../stores/messagesStore";
import { REACTION_EMOJI_CATALOG } from "../composer/emojiCatalog";
import { useDraftsStore } from "../composer/draftsStore";
import { useChatUiStore } from "./chatUiStore";
import type { DecryptState } from "./useDecryptedMessage";
import { togglePin, toggleReaction } from "./socketActions";

/** Shown in the hover toolbar and at the top of the context menu. All are on the server's allowlist. */
export const QUICK_REACTIONS = REACTION_EMOJI_CATALOG.slice(0, 4).map((r) => r.emoji);
export const ALL_REACTIONS = REACTION_EMOJI_CATALOG.map((r) => ({ emoji: r.emoji, name: r.name }));

export type MessageAction = { id: string; label: string; icon: ReactNode; onSelect: () => void; separatorBefore?: boolean };

/** The thread a message belongs to: its parent's thread, or its own if it's a root. */
export const threadRootOf = (message: ChatMessage) => message.parentMessageId ?? message.id;

export function react(conversationId: string, messageId: string, emoji: string) {
  toggleReaction(conversationId, messageId, emoji);
}

/** Actions for a message, shared by the toolbar's "…" menu and the right-click menu. */
export function buildMessageActions(params: {
  conversationId: string;
  message: ChatMessage;
  decrypted: DecryptState;
  senderName: string;
  mine: boolean;
  /** Inside the thread panel, "Reply in thread" is just "Reply". */
  inThread?: boolean;
}): MessageAction[] {
  const { conversationId, message, decrypted, senderName, mine, inThread } = params;
  // Read the store when an action runs, not when the list is built: the draft may have changed since.
  const drafts = () => useDraftsStore.getState();
  const text = decrypted.status === "ok" ? decrypted.envelope.text : "";
  const actions: MessageAction[] = [
    {
      id: "reply",
      label: "Reply",
      icon: <ReplyIcon />,
      onSelect: () => drafts().setReplyTo(inThread ? `${conversationId}#${threadRootOf(message)}` : conversationId, message.id)
    }
  ];
  if (!inThread) {
    actions.push({
      id: "thread",
      label: "Open thread",
      icon: <ThreadIcon />,
      onSelect: () => useChatUiStore.getState().openThread(conversationId, threadRootOf(message))
    });
  }
  if (!mine) {
    actions.push({
      id: "mention",
      label: `Mention ${senderName}`,
      icon: <AtIcon />,
      onSelect: () => {
        const current = drafts().byConversation[conversationId]?.text ?? "";
        const mention = `@${message.sender} `;
        if (!current.startsWith(mention)) drafts().setText(conversationId, mention + current);
      }
    });
  }
  actions.push({
    id: "pin",
    label: message.isPinned ? "Unpin message" : "Pin message",
    icon: <PinIcon />,
    onSelect: () => togglePin(conversationId, message.id)
  });
  if (text) {
    actions.push({
      id: "copy",
      label: "Copy text",
      icon: <CopyIcon />,
      separatorBefore: true,
      onSelect: () => void navigator.clipboard?.writeText(text)
    });
  }
  return actions;
}
