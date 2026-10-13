import { createStore, useStore } from 'zustand';
import type { PreviewKind } from '../lib/fence';
import type { ConsoleEntry } from '../lib/preview-doc';

export type ViewportSize = 'mobile' | 'tablet' | 'desktop';

/** Pixel widths of the viewport presets; desktop fills the panel. */
export const VIEWPORT_WIDTHS: Record<ViewportSize, number | null> = {
  mobile: 375,
  tablet: 768,
  desktop: null,
};

export type DiffSource =
  | { type: 'patch'; patch: string }
  | { type: 'compare'; before: string; after: string; beforeName: string; afterName: string };

export interface PreviewTab {
  id: string;
  kind: PreviewKind | 'diff';
  title: string;
  /** Code being previewed (unused for diffs). */
  source: string;
  diff?: DiffSource;
  /** Identifies the code block a tab follows while its reply streams. */
  sourceKey: string | null;
  /** Bumped by refresh and by source changes; a new value means a fresh frame. */
  version: number;
  logs: ConsoleEntry[];
}

export interface CompareCandidate {
  key: string;
  title: string;
  code: string;
}

export interface PreviewState {
  tabs: PreviewTab[];
  activeId: string | null;
  viewport: ViewportSize;
  consoleOpen: boolean;
  compare: CompareCandidate | null;

  open: (input: {
    kind: PreviewKind;
    title: string;
    source: string;
    sourceKey?: string | null;
  }) => string;
  openDiff: (input: { title: string; diff: DiffSource; sourceKey?: string | null }) => string;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeAll: () => void;
  /** Replaces a tab's code (streaming updates). Starts a fresh run, so its logs are cleared. */
  updateSource: (id: string, source: string) => void;
  refresh: (id: string) => void;
  addLog: (id: string, entry: ConsoleEntry) => void;
  clearLogs: (id: string) => void;
  setViewport: (viewport: ViewportSize) => void;
  setConsoleOpen: (open: boolean) => void;
  startCompare: (candidate: CompareCandidate) => void;
  cancelCompare: () => void;
}

export const MAX_TABS = 8;
export const MAX_LOGS = 500;

let nextId = 1;

export function createPreviewStore() {
  return createStore<PreviewState>()((set, get) => {
    const add = (tab: Omit<PreviewTab, 'id' | 'version' | 'logs'>): string => {
      const existing = tab.sourceKey
        ? get().tabs.find((t) => t.sourceKey === tab.sourceKey)
        : undefined;
      if (existing) {
        set((s) => ({
          activeId: existing.id,
          tabs: s.tabs.map((t) =>
            t.id === existing.id ? { ...t, ...tab, version: t.version + 1, logs: [] } : t,
          ),
        }));
        return existing.id;
      }
      const id = `tab-${nextId++}`;
      set((s) => {
        let tabs = [...s.tabs, { ...tab, id, version: 1, logs: [] }];
        // Over the limit: drop the oldest tab that is not the one just opened.
        while (tabs.length > MAX_TABS) tabs = tabs.slice(1);
        return { tabs, activeId: id };
      });
      return id;
    };

    return {
      tabs: [],
      activeId: null,
      viewport: 'desktop',
      consoleOpen: false,
      compare: null,

      open: ({ kind, title, source, sourceKey = null }) => add({ kind, title, source, sourceKey }),
      openDiff: ({ title, diff, sourceKey = null }) =>
        add({ kind: 'diff', title, source: '', diff, sourceKey }),

      activate: (id) => set({ activeId: id }),

      close: (id) =>
        set((s) => {
          const index = s.tabs.findIndex((t) => t.id === id);
          if (index === -1) return s;
          const tabs = s.tabs.filter((t) => t.id !== id);
          const activeId =
            s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeId;
          return { tabs, activeId };
        }),

      closeAll: () => set({ tabs: [], activeId: null }),

      updateSource: (id, source) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id && t.source !== source
              ? { ...t, source, version: t.version + 1, logs: [] }
              : t,
          ),
        })),

      refresh: (id) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, version: t.version + 1, logs: [] } : t)),
        })),

      addLog: (id, entry) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id ? { ...t, logs: [...t.logs, entry].slice(-MAX_LOGS) } : t,
          ),
        })),

      clearLogs: (id) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, logs: [] } : t)) })),

      setViewport: (viewport) => set({ viewport }),
      setConsoleOpen: (consoleOpen) => set({ consoleOpen }),
      startCompare: (compare) => set({ compare }),
      cancelCompare: () => set({ compare: null }),
    };
  });
}

export const previewStore = createPreviewStore();

export function usePreview<T>(selector: (state: PreviewState) => T): T {
  return useStore(previewStore, selector);
}
