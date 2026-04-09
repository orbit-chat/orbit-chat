import { create } from "zustand";

export type ChatMessage = {
  id: string;
  senderId: string;
  sender: string;
  cipherText: string;
  nonce?: string;
  keyVersion?: number;
  createdAt: number;
  ttlSeconds?: number;
};

type MessagesState = {
  byConversation: Record<string, ChatMessage[]>;
  unreadCountByConversation: Record<string, number>;
  activeConversationId: string | null;
  setActiveConversation: (conversationId: string | null) => void;
  upsertMessage: (
    conversationId: string,
    message: ChatMessage,
    options?: { currentUserId?: string; markAsRead?: boolean }
  ) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
};

export const useMessagesStore = create<MessagesState>((set, get) => ({
  byConversation: {},
  unreadCountByConversation: {},
  activeConversationId: null,
  setActiveConversation: (conversationId) => {
    const currentUnread = get().unreadCountByConversation;
    set({
      activeConversationId: conversationId,
      unreadCountByConversation: conversationId
        ? { ...currentUnread, [conversationId]: 0 }
        : currentUnread,
    });
  },
  upsertMessage: (conversationId, message, options) => {
    const current = get().byConversation[conversationId] ?? [];
    const alreadyExists = current.some((m) => m.id === message.id);
    const withoutOld = current.filter((m) => m.id !== message.id);
    const shouldCountUnread =
      !alreadyExists &&
      !options?.markAsRead &&
      Boolean(options?.currentUserId) &&
      message.senderId !== options?.currentUserId &&
      get().activeConversationId !== conversationId;

    const currentUnread = get().unreadCountByConversation[conversationId] ?? 0;

    set({
      byConversation: {
        ...get().byConversation,
        [conversationId]: [...withoutOld, message].sort((a, b) => a.createdAt - b.createdAt)
      },
      unreadCountByConversation: {
        ...get().unreadCountByConversation,
        [conversationId]: shouldCountUnread ? currentUnread + 1 : currentUnread,
      },
    });
  },
  removeMessage: (conversationId, messageId) => {
    const current = get().byConversation[conversationId] ?? [];
    set({
      byConversation: {
        ...get().byConversation,
        [conversationId]: current.filter((m) => m.id !== messageId)
      }
    });
  }
}));
