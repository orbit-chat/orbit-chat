import { create } from "zustand";
import type { GifLinkAttachment } from "../chat/envelope";

export type PendingFile = {
  id: string;
  file: File;
  /** Object URL for image thumbnails; revoked when the file leaves the draft. */
  previewUrl: string | null;
};

export type Draft = {
  text: string;
  replyToId: string | null;
  files: PendingFile[];
  gif: GifLinkAttachment | null;
};

export const EMPTY_DRAFT: Draft = { text: "", replyToId: null, files: [], gif: null };

type DraftsState = {
  /** Per conversation, so switching chats keeps what you were writing. Memory only: drafts are plaintext. */
  byConversation: Record<string, Draft>;
  setText: (conversationId: string, text: string) => void;
  setReplyTo: (conversationId: string, messageId: string | null) => void;
  addFiles: (conversationId: string, files: File[]) => void;
  removeFile: (conversationId: string, fileId: string) => void;
  setGif: (conversationId: string, gif: GifLinkAttachment | null) => void;
  /** Empty the draft after it was handed to the outbox (keeps nothing, revokes previews). */
  clear: (conversationId: string) => void;
  reset: () => void;
};

let nextId = 0;

function revoke(files: PendingFile[]) {
  for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
}

export const useDraftsStore = create<DraftsState>((set, get) => {
  const update = (conversationId: string, fn: (draft: Draft) => Draft) =>
    set({ byConversation: { ...get().byConversation, [conversationId]: fn(get().byConversation[conversationId] ?? EMPTY_DRAFT) } });

  return {
    byConversation: {},
    setText: (conversationId, text) => update(conversationId, (d) => ({ ...d, text })),
    setReplyTo: (conversationId, replyToId) => update(conversationId, (d) => ({ ...d, replyToId })),
    addFiles: (conversationId, files) =>
      update(conversationId, (d) => ({
        ...d,
        files: [
          ...d.files,
          ...files.map((file) => ({
            id: `f${++nextId}`,
            file,
            previewUrl: file.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null
          }))
        ]
      })),
    removeFile: (conversationId, fileId) =>
      update(conversationId, (d) => {
        revoke(d.files.filter((f) => f.id === fileId));
        return { ...d, files: d.files.filter((f) => f.id !== fileId) };
      }),
    setGif: (conversationId, gif) => update(conversationId, (d) => ({ ...d, gif })),
    clear: (conversationId) => {
      revoke(get().byConversation[conversationId]?.files ?? []);
      const { [conversationId]: _cleared, ...rest } = get().byConversation;
      set({ byConversation: rest });
    },
    reset: () => {
      for (const draft of Object.values(get().byConversation)) revoke(draft.files);
      set({ byConversation: {} });
    }
  };
});

export const useDraft = (conversationId: string) => useDraftsStore((s) => s.byConversation[conversationId] ?? EMPTY_DRAFT);
