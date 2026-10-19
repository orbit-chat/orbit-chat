import { create } from "zustand";

type ChatUiState = {
  /** Open thread per conversation (the root message id). */
  threadRootByConversation: Record<string, string>;
  /** Ask the timeline to scroll to and highlight a message. `seq` makes repeat requests for the same id fire again. */
  jumpRequest: { conversationId: string; messageId: string; seq: number } | null;
  openThread: (conversationId: string, rootId: string) => void;
  closeThread: (conversationId: string) => void;
  jumpTo: (conversationId: string, messageId: string) => void;
  reset: () => void;
};

let seq = 0;

export const useChatUiStore = create<ChatUiState>((set, get) => ({
  threadRootByConversation: {},
  jumpRequest: null,
  openThread: (conversationId, rootId) => set({ threadRootByConversation: { ...get().threadRootByConversation, [conversationId]: rootId } }),
  closeThread: (conversationId) => {
    const { [conversationId]: _closed, ...rest } = get().threadRootByConversation;
    set({ threadRootByConversation: rest });
  },
  jumpTo: (conversationId, messageId) => set({ jumpRequest: { conversationId, messageId, seq: ++seq } }),
  reset: () => set({ threadRootByConversation: {}, jumpRequest: null })
}));
