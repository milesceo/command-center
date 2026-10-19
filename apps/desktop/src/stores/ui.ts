import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePrefs } from './prefs';

export type Theme = 'dark' | 'light';
export type DiffMode = 'inline' | 'split';
/** `landing` is Home: the logo and the launch message. It is where every launch starts. */
export type View = 'landing' | 'chat' | 'usage' | 'prompts' | 'models' | 'plans' | 'settings';
/** `ide` is the editor-style shell; `classic` is the original sidebar-and-column chat layout. */
export type Layout = 'ide' | 'classic';

/** The panels full-width plan reading closed, so leaving it reopens exactly those. */
export interface PlanFullWidth {
  list: boolean;
  sidebar: boolean;
  assistant: boolean;
  preview: boolean;
}

export const RIGHT_PANEL_MIN = 320;
export const RIGHT_PANEL_MAX = 960;
export const RIGHT_PANEL_DEFAULT = 480;

interface UiState {
  theme: Theme;
  layout: Layout;
  sidebarOpen: boolean;
  /** The list beside a business plan; hidden to give the plan the full width. */
  planListOpen: boolean;
  /** What full-width plan reading hid (lib/plan-full-width.ts); null when it is off. */
  planFullWidth: PlanFullWidth | null;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  /** Soft-wrap long lines in code blocks and diffs instead of scrolling horizontally. */
  wrapCode: boolean;
  diffMode: DiffMode;
  /** Transient (not persisted). */
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  /** The Model Lab's Add a model dialog (the palette opens it too). Transient. */
  addModelOpen: boolean;
  view: View;

  toggleTheme: () => void;
  setLayout: (layout: Layout) => void;
  toggleSidebar: () => void;
  setPlanListOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelWidth: (width: number) => void;
  toggleWrapCode: () => void;
  setDiffMode: (mode: DiffMode) => void;
  toggleDiffMode: () => void;
  setShortcutsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setAddModelOpen: (open: boolean) => void;
  setView: (view: View) => void;
}

export const clampPanelWidth = (width: number) =>
  Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, Math.round(width)));

/** Layout and theme preferences; persisted so the window reopens as you left it. */
export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      layout: 'ide',
      sidebarOpen: true,
      planListOpen: true,
      planFullWidth: null,
      rightPanelOpen: false,
      rightPanelWidth: RIGHT_PANEL_DEFAULT,
      wrapCode: false,
      diffMode: 'split',
      shortcutsOpen: false,
      paletteOpen: false,
      addModelOpen: false,
      view: 'landing',

      // The theme is a preference (stores/prefs.ts, which also offers "system"); this store keeps
      // the resolved value for components that only need dark or light.
      toggleTheme: () => usePrefs.getState().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      setLayout: (layout) => set({ layout }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setPlanListOpen: (planListOpen) => set({ planListOpen }),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
      setRightPanelWidth: (width) => set({ rightPanelWidth: clampPanelWidth(width) }),
      toggleWrapCode: () => set((s) => ({ wrapCode: !s.wrapCode })),
      setDiffMode: (diffMode) => set({ diffMode }),
      toggleDiffMode: () => set((s) => ({ diffMode: s.diffMode === 'split' ? 'inline' : 'split' })),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setAddModelOpen: (addModelOpen) => set({ addModelOpen }),
      setView: (view) => set({ view }),
    }),
    {
      name: 'command-center-ui',
      // The shortcuts dialog should never reopen on its own after a restart.
      partialize: ({
        shortcutsOpen: _a,
        view: _b,
        paletteOpen: _c,
        addModelOpen: _d,
        ...persisted
      }) => persisted,
    },
  ),
);

/** Keep <html data-theme> in sync with the store (the CSS tokens key off it). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
