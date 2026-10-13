import { create } from 'zustand';

interface ComposerState {
  /** Text waiting to be inserted into the composer (from the prompt library). */
  pending: { id: number; text: string } | null;
  insert: (text: string) => void;
  consume: (id: number) => void;
}

let next = 1;

/** A one-slot mailbox: the library asks, the composer (which owns the caret) inserts. */
export const useComposerStore = create<ComposerState>()((set, get) => ({
  pending: null,
  insert: (text) => set({ pending: { id: next++, text } }),
  consume: (id) => {
    if (get().pending?.id === id) set({ pending: null });
  },
}));
