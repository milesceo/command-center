// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../lib/db';
import { createTestDb } from '../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));
vi.mock('../lib/tauri', () => ({ isTauri: () => false, createTauriTransport: () => ({}) }));

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
  // jsdom has no matchMedia or ResizeObserver; the lock screen's animation checks both.
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  hoisted.db = createTestDb();
  localStorage.clear();
});
afterEach(cleanup);

const { App } = await import('../App');
const { chatStore } = await import('../stores/chat');
const { conversationsStore } = await import('../stores/conversations');
const { useUiStore } = await import('../stores/ui');
const { useIdeStore } = await import('../stores/ide');
const { useLockStore } = await import('../stores/lock');
const { usePrefs } = await import('../stores/prefs');
const { defaultPrefs } = await import('../lib/prefs');

beforeEach(() => {
  conversationsStore.setState({
    conversations: [],
    activeId: null,
    search: '',
    loaded: false,
    error: null,
  });
  chatStore.setState({ loadedFor: null, messages: [], streams: {}, errors: {} });
  useUiStore.setState({
    layout: 'ide',
    view: 'chat',
    sidebarOpen: true,
    rightPanelOpen: false,
    paletteOpen: false,
  });
  useIdeStore.setState({
    assistantOpen: true,
    bottomOpen: false,
    collapsedProjects: {},
    collapsedSections: {},
    activeFile: {},
    closedFiles: {},
  });
  useLockStore.setState({ phase: 'unlocked', hasPin: false, failures: 0, lockedUntil: 0 });
  // Onboarding is covered in its own test; these tests start from a finished setup.
  const prefs = defaultPrefs();
  usePrefs.setState({
    prefs: { ...prefs, onboarding: { completed: true, step: 0 }, profile: { name: 'Ada' } },
  });
});

const key = (k: string, init: Partial<KeyboardEventInit> = {}) =>
  act(() => void fireEvent.keyDown(window, { key: k, ctrlKey: true, ...init }));

describe('editor shell', () => {
  it('deletes a chat from the explorer after confirming', async () => {
    const repo = await import('../lib/repo');
    const { DEFAULT_SETTINGS } = await import('../lib/types');
    const keep = await repo.createConversation(hoisted.db, DEFAULT_SETTINGS);
    await repo.renameConversation(hoisted.db, keep.id, 'Keep me');
    const gone = await repo.createConversation(hoisted.db, DEFAULT_SETTINGS);
    await repo.renameConversation(hoisted.db, gone.id, 'Old chat');
    render(<App />);
    const explorer = await screen.findByRole('complementary', { name: 'Explorer' });
    fireEvent.click(await within(explorer).findByRole('button', { name: 'Delete Old chat' }));
    // Cancel keeps it.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(within(explorer).getByRole('button', { name: /^Old chat/ })).toBeTruthy();

    fireEvent.click(within(explorer).getByRole('button', { name: 'Delete Old chat' }));
    expect(
      screen.getByText(/“Old chat” and all of its messages will be permanently deleted/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(within(explorer).queryByRole('button', { name: /^Old chat/ })).toBeNull(),
    );
    expect(await repo.getConversation(hoisted.db, gone.id)).toBeNull();
    expect(within(explorer).getByRole('button', { name: /^Keep me/ })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Filter threads' })),
    );
  });

  it('deleting the open chat returns the editor to the welcome screen', async () => {
    const repo = await import('../lib/repo');
    const { DEFAULT_SETTINGS } = await import('../lib/types');
    const open = await repo.createConversation(hoisted.db, DEFAULT_SETTINGS);
    await repo.renameConversation(hoisted.db, open.id, 'Open chat');
    // A code block gives the thread a file, so the editor shows it instead of the welcome.
    await repo.insertMessage(hoisted.db, {
      id: 'a1',
      conversationId: open.id,
      role: 'assistant',
      content: '```ts title="a.ts"\nexport const a = 1;\n```',
      attachments: [],
      status: 'complete',
      error: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: null,
      createdAt: Date.now(),
    });
    render(<App />);
    const explorer = await screen.findByRole('complementary', { name: 'Explorer' });
    fireEvent.click(await within(explorer).findByRole('button', { name: /^Open chat/ }));
    await waitFor(() =>
      expect(screen.getByLabelText('Editor', { selector: 'section' })).toBeTruthy(),
    );
    expect(screen.queryByLabelText('Welcome')).toBeNull();

    fireEvent.click(within(explorer).getByRole('button', { name: 'Delete Open chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByLabelText('Welcome')).toBeTruthy());
    expect(conversationsStore.getState().activeId).toBeNull();
    expect(await repo.getConversation(hoisted.db, open.id)).toBeNull();
  });

  it('stops a streaming reply before deleting its chat', async () => {
    const repo = await import('../lib/repo');
    const { DEFAULT_SETTINGS } = await import('../lib/types');
    const busy = await repo.createConversation(hoisted.db, DEFAULT_SETTINGS);
    await repo.renameConversation(hoisted.db, busy.id, 'Busy chat');
    const originalStop = chatStore.getState().stop;
    const stop = vi.fn();
    chatStore.setState({
      stop,
      streams: {
        [busy.id]: {
          messageId: 'm1',
          requestId: 'r1',
          text: 'partial',
          tools: [],
          rateLimit: null,
          startedAt: Date.now(),
        },
      },
    });
    try {
      render(<App />);
      const explorer = await screen.findByRole('complementary', { name: 'Explorer' });
      fireEvent.click(await within(explorer).findByRole('button', { name: 'Delete Busy chat' }));
      expect(stop).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(stop).toHaveBeenCalledWith(busy.id);
      await waitFor(async () => expect(await repo.getConversation(hoisted.db, busy.id)).toBeNull());
    } finally {
      chatStore.setState({ stop: originalStop });
    }
  });

  it('shows the explorer, editor welcome and assistant, and toggles panels from the keyboard', () => {
    render(<App />);
    expect(screen.getByTestId('ide-shell')).toBeTruthy();
    expect(screen.getByLabelText('Explorer', { selector: 'aside' })).toBeTruthy();
    expect(screen.getByLabelText('Welcome')).toBeTruthy();
    expect(screen.getByLabelText('Assistant')).toBeTruthy();
    expect(screen.queryByLabelText('Activity', { selector: 'section' })).toBeNull();

    key('A', { shiftKey: true });
    expect(screen.queryByLabelText('Assistant')).toBeNull();
    key('A', { shiftKey: true });
    expect(screen.getByLabelText('Assistant')).toBeTruthy();

    key('j');
    expect(screen.getByLabelText('Activity', { selector: 'section' })).toBeTruthy();
    key('j');
    expect(screen.queryByLabelText('Activity', { selector: 'section' })).toBeNull();
  });

  it('opens the secondary views in the editor area from the activity bar', async () => {
    render(<App />);
    const rail = screen.getByRole('navigation', { name: 'Activity' });
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(within(rail).getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(screen.getByLabelText('Welcome')).toBeTruthy());
  });

  it('shows Business plans in the activity bar and toggles its view', async () => {
    const { usePlans } = await import('../stores/plans');
    usePlans.setState({ plans: [], loaded: false, error: null, selectedId: null });
    render(<App />);
    const rail = screen.getByRole('navigation', { name: 'Activity' });
    const labels = within(rail)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    // Right after Home and Explorer.
    expect(labels.slice(0, 3)).toEqual(['Home', 'Explorer', 'Business plans']);
    const button = within(rail).getByRole('button', { name: 'Business plans' });
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(await screen.findByRole('heading', { name: 'Business plans' })).toBeTruthy();
    expect(await screen.findByText('No plans yet')).toBeTruthy();
    expect(useUiStore.getState().view).toBe('plans');
    expect(button.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByLabelText('Welcome')).toBeTruthy());
    expect(useUiStore.getState().view).toBe('chat');
  });

  it('opens Business plans from the classic Library list', async () => {
    act(() => useUiStore.getState().setLayout('classic'));
    render(<App />);
    const library = screen.getByRole('navigation', { name: 'Library' });
    const names = within(library)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
    expect(names[0]).toBe('Business plans');
    fireEvent.click(within(library).getByRole('button', { name: 'Business plans' }));
    expect(await screen.findByTestId('business-plans')).toBeTruthy();
    expect(useUiStore.getState().view).toBe('plans');
  });

  it('switches to the classic layout and back from the layout flag', () => {
    render(<App />);
    act(() => useUiStore.getState().setLayout('classic'));
    expect(screen.queryByTestId('ide-shell')).toBeNull();
    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy();
    act(() => useUiStore.getState().setLayout('ide'));
    expect(screen.getByTestId('ide-shell')).toBeTruthy();
  });
});

describe('lock screen', () => {
  const type = (value: string) => {
    const input = screen.getByLabelText(/PIN/i, { selector: 'input' });
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest('form')!);
  };

  it('locks on demand, rejects a wrong PIN, and unlocks with the right one', async () => {
    await act(() => useLockStore.getState().setPin('2468'));
    render(<App />);
    expect(screen.getByTestId('ide-shell')).toBeTruthy();

    key('l');
    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    // The app itself is not in the DOM behind the lock.
    expect(screen.queryByTestId('ide-shell')).toBeNull();

    type('1111');
    expect(await screen.findByText('Wrong PIN.')).toBeTruthy();
    expect(screen.getByTestId('lock-screen')).toBeTruthy();

    type('2468');
    expect(await screen.findByTestId('ide-shell')).toBeTruthy();
  });

  it('accepts letters and symbols in a PIN', async () => {
    await act(() => useLockStore.getState().setPin('p@ss7'));
    act(() => useLockStore.getState().lock());
    render(<App />);
    type('P@SS7');
    expect(await screen.findByText('Wrong PIN.')).toBeTruthy();
    type('p@ss7');
    expect(await screen.findByTestId('ide-shell')).toBeTruthy();
  });

  it('imposes a waiting period after repeated wrong PINs', async () => {
    await act(() => useLockStore.getState().setPin('2468'));
    act(() => useLockStore.getState().lock());
    render(<App />);
    for (let i = 0; i < 5; i++) {
      type('9999');
      await waitFor(() => expect(useLockStore.getState().failures).toBe(i + 1));
    }
    expect(await screen.findByText(/Locked for \d+s/)).toBeTruthy();
    // Even the right PIN is refused while waiting.
    expect(await useLockStore.getState().unlock('2468')).toBe('wait');
    expect(useLockStore.getState().phase).toBe('locked');
  });

  it('shows Home first, and Forgot PIN explains that nothing can be recovered', async () => {
    await act(() => useLockStore.getState().setPin('2468'));
    act(() => useLockStore.getState().lock());
    useUiStore.setState({ view: 'landing' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /forgot PIN/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/cannot be recovered/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /erase and reset/i })).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('editor shell keys by platform', () => {
  const setPlatform = (value: string) =>
    Object.defineProperty(navigator, 'platform', { configurable: true, value });
  /** Fires a keydown on the window; returns true when the shell called preventDefault. */
  const press = (k: string, init: Partial<KeyboardEventInit>) => {
    let prevented = false;
    act(() => {
      prevented = !fireEvent.keyDown(window, { key: k, ...init });
    });
    return prevented;
  };

  it('on macOS only Cmd triggers: Ctrl+T, Ctrl+J and Ctrl+P are left to the text field', () => {
    setPlatform('MacIntel');
    render(<App />);
    useUiStore.setState({ view: 'settings' });
    const newChat = vi.spyOn(conversationsStore.getState(), 'newChat');

    expect(press('t', { ctrlKey: true })).toBe(false);
    expect(newChat).not.toHaveBeenCalled();
    expect(useUiStore.getState().view).toBe('settings');

    expect(press('j', { ctrlKey: true })).toBe(false);
    expect(useIdeStore.getState().bottomOpen).toBe(false);
    expect(press('p', { ctrlKey: true })).toBe(false);
    expect(useUiStore.getState().paletteOpen).toBe(false);
    expect(press('A', { ctrlKey: true, shiftKey: true })).toBe(false);
    expect(useIdeStore.getState().assistantOpen).toBe(true);

    expect(press('t', { metaKey: true })).toBe(true);
    expect(newChat).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().view).toBe('chat');
    expect(press('j', { metaKey: true })).toBe(true);
    expect(useIdeStore.getState().bottomOpen).toBe(true);
    expect(press('A', { metaKey: true, shiftKey: true })).toBe(true);
    expect(useIdeStore.getState().assistantOpen).toBe(false);
    expect(press('p', { metaKey: true })).toBe(true);
    expect(useUiStore.getState().paletteOpen).toBe(true);
    newChat.mockRestore();
  });

  it('off macOS Ctrl and the Win/Super key both trigger, as before', () => {
    setPlatform('Win32');
    render(<App />);
    useUiStore.setState({ view: 'settings' });
    const newChat = vi.spyOn(conversationsStore.getState(), 'newChat');

    expect(press('j', { metaKey: true })).toBe(true);
    expect(useIdeStore.getState().bottomOpen).toBe(true);
    expect(press('t', { ctrlKey: true })).toBe(true);
    expect(newChat).toHaveBeenCalled();
  });

  it('ignores Option/Alt on both platforms', () => {
    setPlatform('MacIntel');
    render(<App />);
    expect(press('j', { metaKey: true, altKey: true })).toBe(false);
    expect(useIdeStore.getState().bottomOpen).toBe(false);
    cleanup();
    setPlatform('Win32');
    render(<App />);
    expect(press('j', { ctrlKey: true, altKey: true })).toBe(false);
    expect(useIdeStore.getState().bottomOpen).toBe(false);
  });

  it('locks with Cmd+L on macOS but not with Ctrl+L', () => {
    setPlatform('MacIntel');
    useLockStore.setState({ phase: 'unlocked', hasPin: true });
    const lock = vi.spyOn(useLockStore.getState(), 'lock');
    render(<App />);
    expect(press('l', { ctrlKey: true })).toBe(false);
    expect(lock).not.toHaveBeenCalled();
    expect(press('l', { metaKey: true })).toBe(true);
    expect(lock).toHaveBeenCalledTimes(1);
    lock.mockRestore();
  });
});
