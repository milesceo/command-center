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

describe('ui store persistence', () => {
  const KEY = 'command-center-ui';
  const saved = () =>
    JSON.parse(localStorage.getItem(KEY) ?? '{}') as { state?: Record<string, unknown> };

  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState(useUiStore.getInitialState(), true);
  });

  it('saves the plan list choice and the full-width record', () => {
    const record = { list: true, sidebar: false, assistant: true, preview: false };
    useUiStore.setState({ planListOpen: false, planFullWidth: record });
    expect(saved().state).toMatchObject({ planListOpen: false, planFullWidth: record });
    // Transient fields stay out.
    expect(saved().state).not.toHaveProperty('view');
  });

  it('rehydrates a saved full-width record', async () => {
    const record = { list: true, sidebar: true, assistant: false, preview: true };
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { planListOpen: false, planFullWidth: record }, version: 0 }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState()).toMatchObject({ planListOpen: false, planFullWidth: record });
  });

  it('an older saved value without the plan fields rehydrates to list shown and full width off', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { theme: 'light', layout: 'classic', sidebarOpen: false },
        version: 0,
      }),
    );
    await useUiStore.persist.rehydrate();
    expect(useUiStore.getState()).toMatchObject({
      layout: 'classic',
      sidebarOpen: false,
      planListOpen: true,
      planFullWidth: null,
    });
  });
});
