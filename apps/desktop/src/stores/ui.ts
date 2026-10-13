import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';
export type DiffMode = 'inline' | 'split';

export const RIGHT_PANEL_MIN = 320;
export const RIGHT_PANEL_MAX = 960;
export const RIGHT_PANEL_DEFAULT = 480;

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  /** Soft-wrap long lines in code blocks and diffs instead of scrolling horizontally. */
  wrapCode: boolean;
  diffMode: DiffMode;
  /** Transient (not persisted). */
  shortcutsOpen: boolean;

  toggleTheme: () => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelWidth: (width: number) => void;
  toggleWrapCode: () => void;
  setDiffMode: (mode: DiffMode) => void;
  toggleDiffMode: () => void;
  setShortcutsOpen: (open: boolean) => void;
}

export const clampPanelWidth = (width: number) =>
  Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, Math.round(width)));

/** Layout and theme preferences; persisted so the window reopens as you left it. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarOpen: true,
      rightPanelOpen: false,
      rightPanelWidth: RIGHT_PANEL_DEFAULT,
      wrapCode: false,
      diffMode: 'split',
      shortcutsOpen: false,

      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
      setRightPanelWidth: (width) => set({ rightPanelWidth: clampPanelWidth(width) }),
      toggleWrapCode: () => set((s) => ({ wrapCode: !s.wrapCode })),
      setDiffMode: (diffMode) => set({ diffMode }),
      toggleDiffMode: () => set((s) => ({ diffMode: s.diffMode === 'split' ? 'inline' : 'split' })),
      setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
    }),
    {
      name: 'programish-ui',
      // The shortcuts dialog should never reopen on its own after a restart.
      partialize: ({ shortcutsOpen: _transient, ...persisted }) => persisted,
    },
  ),
);

/** Keep <html data-theme> in sync with the store (the CSS tokens key off it). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
