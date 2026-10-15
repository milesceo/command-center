// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { usePrefs } from './prefs';
import { applyTheme, useUiStore } from './ui';

describe('ui store', () => {
  beforeEach(() => {
    useUiStore.setState({ theme: 'dark', sidebarOpen: true, rightPanelOpen: false });
  });

  it('defaults to dark, and toggling writes the preference (the app resolves it back here)', () => {
    expect(useUiStore.getState().theme).toBe('dark');
    useUiStore.getState().toggleTheme();
    expect(usePrefs.getState().prefs.appearance.theme).toBe('light');
    // App.tsx mirrors the resolved theme into this store; emulate that step.
    useUiStore.setState({ theme: 'light' });
    useUiStore.getState().toggleTheme();
    expect(usePrefs.getState().prefs.appearance.theme).toBe('dark');
  });

  it('applies the theme to the document root', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('toggles panels independently', () => {
    useUiStore.getState().toggleRightPanel();
    expect(useUiStore.getState()).toMatchObject({ rightPanelOpen: true, sidebarOpen: true });
  });
});
