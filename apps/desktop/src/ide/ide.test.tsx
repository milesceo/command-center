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
