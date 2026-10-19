import type { ReactNode } from "react";
import { ArchiveIcon, CheckIcon, InboxIcon, LockIcon, PinIcon, SettingsIcon, TrashIcon } from "../../ui/icons";
import { useChatLockStore } from "../../stores/chatLockStore";
import { useMessagesStore } from "../../stores/messagesStore";
import { routeConversationId, useNavigationStore } from "../../stores/navigationStore";
import { usePrefsStore, useUserPrefs } from "../../stores/prefsStore";
import type { Conversation } from "./conversationsStore";
import { useDialogStore } from "../chat-settings/dialogStore";

export type ConversationAction = {
  id: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
};

/**
 * What you can do to a conversation from the list. Shared by the right-click menu and
 * the "…" button so both always offer the same thing.
 */
export function useConversationActions(conversation: Conversation): ConversationAction[] {
  const prefs = useUserPrefs();
  const unread = useMessagesStore((s) => s.unreadCountByConversation[conversation.id] ?? 0);
  const unlocked = useChatLockStore((s) => Boolean(s.unlocked[conversation.id]));
  const pinned = prefs.pinnedConversationIds.includes(conversation.id);
  const archived = prefs.archivedConversationIds.includes(conversation.id);

  const actions: ConversationAction[] = [];

  if (unread > 0) {
    actions.push({
      id: "read",
      label: "Mark as read",
      icon: <CheckIcon />,
      onSelect: () => useMessagesStore.getState().markRead(conversation.id)
    });
  }

  if (conversation.passcodeEnabled && unlocked) {
    actions.push({
      id: "relock",
      label: "Lock chat",
      icon: <LockIcon />,
      onSelect: () => useChatLockStore.getState().lock(conversation.id)
    });
  }

  actions.push({
    id: "pin",
    label: pinned ? "Unpin" : "Pin to top",
    icon: <PinIcon />,
    onSelect: () => usePrefsStore.getState().togglePinned(conversation.id)
  });

  actions.push({
    id: "archive",
    label: archived ? "Unarchive" : "Archive",
    icon: archived ? <InboxIcon /> : <ArchiveIcon />,
    onSelect: () => {
      usePrefsStore.getState().toggleArchived(conversation.id);
      const nav = useNavigationStore.getState();
      if (routeConversationId(nav.route) !== conversation.id) return;
      // Keep the open chat visible on the page it now belongs to.
      if (archived) nav.openConversation(conversation);
      else nav.openConversation(conversation, { archived: true });
    }
  });

  actions.push({
    id: "settings",
    label: "Chat settings…",
    icon: <SettingsIcon />,
    separatorBefore: true,
    onSelect: () => useDialogStore.getState().open({ kind: "chatSettings", conversationId: conversation.id })
  });

  actions.push({
    id: "delete",
    label: conversation.type === "dm" ? "Delete chat…" : "Leave group…",
    icon: <TrashIcon />,
    danger: true,
    onSelect: () => useDialogStore.getState().open({ kind: "deleteOrLeave", conversationId: conversation.id })
  });

  return actions;
}
