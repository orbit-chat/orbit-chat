import { create } from "zustand";

export type AppDialog =
  | { kind: "chatSettings"; conversationId: string }
  | { kind: "deleteOrLeave"; conversationId: string }
  | { kind: "addMembers"; conversationId: string }
  | { kind: "createGroup" };

type DialogState = {
  /** At most one app dialog at a time, rendered by DialogHost; menus and buttons just open it. */
  current: AppDialog | null;
  open: (dialog: AppDialog) => void;
  close: () => void;
};

export const useDialogStore = create<DialogState>((set) => ({
  current: null,
  open: (dialog) => set({ current: dialog }),
  close: () => set({ current: null })
}));
