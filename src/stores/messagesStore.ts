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
  upsertMessage: (conversationId: string, message: ChatMessage) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
};

export const useMessagesStore = create<MessagesState>((set, get) => ({
  byConversation: {},
  upsertMessage: (conversationId, message) => {
    const current = get().byConversation[conversationId] ?? [];
    const withoutOld = current.filter((m) => m.id !== message.id);
    set({
      byConversation: {
        ...get().byConversation,
        [conversationId]: [...withoutOld, message].sort((a, b) => a.createdAt - b.createdAt)
      }
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
