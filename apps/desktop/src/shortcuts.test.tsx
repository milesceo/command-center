// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './lib/db';
import { message } from './lib/test-fixtures';
import { createTestDb } from './lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('./lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));
vi.mock('./lib/tauri', () => ({ isTauri: () => false, createTauriTransport: () => ({}) }));

const writeText = vi.fn(() => Promise.resolve());
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
  writeText.mockClear();
  hoisted.db = createTestDb();
});
afterEach(cleanup);

const { App } = await import('./App');
const { chatStore } = await import('./stores/chat');
const { previewStore } = await import('./stores/preview');
const { useUiStore } = await import('./stores/ui');
const { useToastStore } = await import('./stores/toast');

beforeEach(() => {
  chatStore.setState({ messages: [], streams: {}, loadedFor: null, errors: {} });
  previewStore.setState({ tabs: [], activeId: null, compare: null });
  useUiStore.setState({
    rightPanelOpen: false,
    diffMode: 'split',
    shortcutsOpen: false,
    sidebarOpen: true,
  });
  useToastStore.setState({ toasts: [] });
});

const press = (key: string, over: Partial<KeyboardEventInit> = {}) =>
  act(() => void fireEvent.keyDown(window, { key, ctrlKey: true, ...over }));

describe('keyboard shortcuts', () => {
  it('toggles the preview panel with Ctrl+Shift+P', () => {
    render(<App />);
    press('P', { shiftKey: true });
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
    expect(screen.getByLabelText('Preview')).toBeTruthy();
    press('P', { shiftKey: true });
    expect(useUiStore.getState().rightPanelOpen).toBe(false);
  });

  it('toggles diff mode with Ctrl+Shift+D and says so', async () => {
    render(<App />);
    press('D', { shiftKey: true });
    expect(useUiStore.getState().diffMode).toBe('inline');
    expect(await screen.findByText('Diffs: inline')).toBeTruthy();
    press('D', { shiftKey: true });
    expect(useUiStore.getState().diffMode).toBe('split');
  });

  it('copies the last code block of the last reply with Ctrl+Shift+C', async () => {
    render(<App />);
    // Set after mounting: the app clears messages when it loads the (empty) active conversation.
    act(() =>
      chatStore.setState({
        messages: [
          message({
            id: 'm1',
            role: 'assistant',
            content: 'first\n```ts\nconst a = 1;\n```\nthen\n```py\nprint("last")\n```\n',
          }),
        ],
      }),
    );
    press('C', { shiftKey: true });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print("last")'));
    expect(await screen.findByText('Copied last code block')).toBeTruthy();
  });

  it('says so when there is no code block to copy', async () => {
    render(<App />);
    press('C', { shiftKey: true });
    expect(await screen.findByText('No code block to copy')).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('shows every shortcut in a dialog (Ctrl+/ or the sidebar button) and closes it with Escape', () => {
    render(<App />);
    press('/');
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const text of [
      'Copy the last code block',
      'Show or hide the preview panel',
      'Switch diffs between side-by-side and inline',
      'Send the message',
    ]) {
      expect(dialog.textContent).toContain(text);
    }
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('Escape cancels a pending comparison', () => {
    render(<App />);
    previewStore.getState().startCompare({ key: 'k', title: 't', code: 'c' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(previewStore.getState().compare).toBeNull();
  });

  it('ignores ordinary typing and plain Ctrl+C', () => {
    render(<App />);
    press('c');
    press('p', { shiftKey: false });
    expect(useUiStore.getState().rightPanelOpen).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
