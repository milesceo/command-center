// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, useUiStore } from './ui';

describe('ui store', () => {
  beforeEach(() => {
    useUiStore.setState({ theme: 'dark', sidebarOpen: true, rightPanelOpen: false });
  });

  it('defaults to dark and toggles to light and back', () => {
    expect(useUiStore.getState().theme).toBe('dark');
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('light');
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe('dark');
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
