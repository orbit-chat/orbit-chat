import { create } from "zustand";

export type PasscodeReveal = { conversationId: string; passcode: string; label: string };

type PasscodeRevealState = {
  /** A one-time passcode waiting to be acknowledged. Memory only; the server never shows it again. */
  current: PasscodeReveal | null;
  show: (reveal: PasscodeReveal) => void;
  dismiss: () => void;
};

export const usePasscodeRevealStore = create<PasscodeRevealState>((set) => ({
  current: null,
  show: (reveal) => set({ current: reveal }),
  dismiss: () => set({ current: null })
}));
