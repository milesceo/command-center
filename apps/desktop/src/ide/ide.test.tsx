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
  useLockStore.setState({
    phase: 'unlocked',
    hasPin: false,
    failures: 0,
    lockedUntil: 0,
    autoLockMinutes: 0,
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
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('asks a first-time user to choose a PIN, confirms it, and enters the app', async () => {
    useLockStore.setState({ phase: 'setup', hasPin: false });
    render(<App />);
    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    expect(screen.getByText(/Choose a PIN/)).toBeTruthy();
    // The app itself is not in the DOM behind the lock.
    expect(screen.queryByTestId('ide-shell')).toBeNull();

    type('4821');
    expect(await screen.findByText(/Confirm your PIN/)).toBeTruthy();
    type('4821');
    expect(await screen.findByTestId('ide-shell')).toBeTruthy();
    expect(useLockStore.getState().hasPin).toBe(true);
    // Only a hash is stored.
    expect(localStorage.getItem('geeked-lock')).not.toContain('4821');
  });

  it('rejects a mismatched confirmation', async () => {
    useLockStore.setState({ phase: 'setup', hasPin: false });
    render(<App />);
    type('1357');
    await screen.findByText(/Confirm your PIN/);
    type('1358');
    expect(await screen.findByText(/did not match/i)).toBeTruthy();
    expect(screen.getByText(/Choose a PIN/)).toBeTruthy();
  });

  it('can be skipped, leaving no PIN', () => {
    useLockStore.setState({ phase: 'setup', hasPin: false });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /continue without a PIN/i }));
    expect(screen.getByTestId('ide-shell')).toBeTruthy();
    expect(useLockStore.getState().hasPin).toBe(false);
  });

  it('locks on demand, rejects a wrong PIN, and unlocks with the right one', async () => {
    await act(() => useLockStore.getState().setup('2468'));
    render(<App />);
    expect(screen.getByTestId('ide-shell')).toBeTruthy();

    key('l');
    expect(screen.getByTestId('lock-screen')).toBeTruthy();
    expect(screen.queryByTestId('ide-shell')).toBeNull();

    type('1111');
    expect(await screen.findByText('Wrong PIN.')).toBeTruthy();
    expect(screen.getByTestId('lock-screen')).toBeTruthy();

    type('2468');
    expect(await screen.findByTestId('ide-shell')).toBeTruthy();
  });

  it('imposes a waiting period after repeated wrong PINs', async () => {
    await act(() => useLockStore.getState().setup('2468'));
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
});
