import { create } from 'zustand';
import type { QaItem } from '../qa/checklist';
import type { QaResult, QaResults, QaStatus } from '../qa/report';

const KEY = 'geeked-qa';

interface Persisted {
  enabled: boolean;
  results: QaResults;
}

/** Development builds show the panel by default; release builds keep it off until enabled in Settings. */
const DEFAULT_ENABLED = import.meta.env.DEV;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function load(): Persisted {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return { enabled: DEFAULT_ENABLED, results: {} };
    const value = JSON.parse(raw) as Partial<Persisted>;
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_ENABLED,
      results: typeof value.results === 'object' && value.results ? value.results : {},
    };
  } catch {
    return { enabled: DEFAULT_ENABLED, results: {} };
  }
}

function save(state: Persisted): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(state));
  } catch {
    // The panel still works for this session.
  }
}

interface QaState extends Persisted {
  open: boolean;
  setEnabled: (enabled: boolean) => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  answer: (item: QaItem, status: QaStatus, note?: string) => void;
  clear: (id: string) => void;
  resetAll: () => void;
}

export const useQa = create<QaState>()((set, get) => {
  const initial = load();
  const persist = () => save({ enabled: get().enabled, results: get().results });

  return {
    ...initial,
    open: false,

    setEnabled: (enabled) => {
      set({ enabled, ...(enabled ? {} : { open: false }) });
      persist();
    },
    toggleOpen: () => {
      if (!get().enabled) return;
      set((s) => ({ open: !s.open }));
    },
    setOpen: (open) => set({ open: open && get().enabled }),

    answer: (item, status, note = '') => {
      const result: QaResult = { status, note, at: Date.now(), rev: item.rev };
      set((s) => ({ results: { ...s.results, [item.id]: result } }));
      persist();
    },
    clear: (id) => {
      set((s) => {
        const next = { ...s.results };
        delete next[id];
        return { results: next };
      });
      persist();
    },
    resetAll: () => {
      set({ results: {} });
      persist();
    },
  };
});
