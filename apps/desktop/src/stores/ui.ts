import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
}

/** Layout and theme preferences; persisted so the window reopens as you left it. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarOpen: true,
      rightPanelOpen: false,
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
    }),
    { name: 'programish-ui' },
  ),
);

/** Keep <html data-theme> in sync with the store (the CSS tokens key off it). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
