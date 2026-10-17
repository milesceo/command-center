// @vitest-environment jsdom
import type { BridgeEvent } from '@command-center/protocol';
import type * as LockBackendModule from './lib/lock-backend';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from './lib/db';
import type { TrayHandlers } from './lib/system';
import { createTestDb } from './lib/sqlite-test-db';

// The app talks to SQLite and the sidecar through two seams; fake both so the
// real stores and components run unchanged.
const hoisted = vi.hoisted(() => ({
  db: undefined as unknown as Db,
  script: { current: 'echo' as 'echo' | 'slow' | 'auth' | 'limit' },
  tray: { current: null as null | TrayHandlers },
}));

vi.mock('./lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));
vi.mock('./lib/tauri', () => ({ isTauri: () => true, createTauriTransport: () => ({}) }));
// No real window or tray under test.
vi.mock('./lib/system', () => ({
  system: {
    available: () => false,
    setCloseBehavior: () => Promise.resolve(),
    setAutostart: () => Promise.resolve(false),
    isAutostartEnabled: () => Promise.resolve(false),
  },
  listenToTray: (handlers: TrayHandlers) => {
    hoisted.tray.current = handlers;
    return Promise.resolve(() => undefined);
  },
}));
vi.mock('./lib/lock-backend', async (importOriginal) => {
  const actual = await importOriginal<typeof LockBackendModule>();
  return { ...actual, lockBackend: () => actual.webLockBackend };
});
vi.mock('./lib/bridge-client', () => ({
  getBridgeClient: () => ({
    connect: () => Promise.resolve(),
    ping: () => Promise.resolve({ latencyMs: 3, bridgeVersion: '0.2.0', protocolVersion: 2 }),
    onExit: () => () => {},
    chat(request: { messages: { content: string }[] }, onEvent: (e: BridgeEvent) => void) {
      const id = `req-${Math.random()}`;
      let stopped = false;
      const last = request.messages[request.messages.length - 1]?.content ?? '';
      const emit = (e: BridgeEvent) => act(() => onEvent(e));
      void (async () => {
        const mode = hoisted.script.current;
        if (mode === 'auth') {
          emit({
            type: 'error',
            id,
            error: { code: 'auth_required', message: 'Error: at node:internal/x.js:1' },
          });
          return;
        }
        if (mode === 'limit') {
          emit({
            type: 'error',
            id,
            error: {
              code: 'usage_limit',
              message: 'm',
              limitType: 'five_hour',
              resetsAt: Date.now() + 7_200_000,
            },
          });
          return;
        }
        const words =
          mode === 'slow'
            ? ['Part ', 'one ', 'of ', 'a ', 'very ', 'long ', 'reply ', 'that ', 'keeps ', 'going']
            : [`Echo: **${last}**`];
        for (const w of words) {
          if (stopped) break;
          emit({ type: 'chat.text', id, text: w });
          await new Promise((r) => setTimeout(r, mode === 'slow' ? 30 : 0));
        }
        emit(
          stopped
            ? { type: 'chat.done', id, status: 'cancelled' }
            : { type: 'chat.done', id, status: 'completed' },
        );
      })();
      return { id, done: Promise.resolve(), cancel: () => (stopped = true) };
    },
  }),
}));

// jsdom has no layout; give the virtualizer a viewport so it renders rows.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 800,
  });
  hoisted.db = createTestDb();
  hoisted.script.current = 'echo';
  localStorage.clear();
});
afterEach(cleanup);

const { App } = await import('./App');
const { chatStore } = await import('./stores/chat');
const { conversationsStore } = await import('./stores/conversations');
const { useUiStore } = await import('./stores/ui');
const { useLockStore } = await import('./stores/lock');
const { usePrefs } = await import('./stores/prefs');
const { defaultPrefs } = await import('./lib/prefs');

function resetStores() {
  conversationsStore.setState({
    conversations: [],
    activeId: null,
    search: '',
    loaded: false,
    error: null,
  });
  chatStore.setState({ loadedFor: null, messages: [], streams: {}, errors: {} });
  // These tests cover the classic layout; the editor shell and the lock have their own tests.
  useUiStore.setState({
    theme: 'dark',
    layout: 'classic',
    sidebarOpen: true,
    rightPanelOpen: false,
  });
  useLockStore.setState({ phase: 'unlocked', hasPin: false });
  // Setup is covered by its own tests; these start from a finished onboarding and the chat view.
  usePrefs.setState({
    prefs: { ...defaultPrefs(), onboarding: { completed: true, step: 0 } },
  });
  useUiStore.setState({ view: 'chat' });
}
beforeEach(resetStores);

async function send(text: string) {
  const box = screen.getByLabelText('Message');
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

describe('shell', () => {
  it('renders the sidebar and empty state, toggles theme and the preview panel', async () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy();
    expect(screen.getByText('What are we building?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /switch to light theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');

    expect(screen.queryByLabelText('Preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /toggle preview panel/i }));
    expect(screen.getByLabelText('Preview')).toBeTruthy();
  });
});

describe('chat', () => {
  it('sends with Enter, streams markdown, and lists the conversation', async () => {
    render(<App />);
    await send('hello there');
    await waitFor(() =>
      expect(screen.getByText('hello there', { selector: 'strong' })).toBeTruthy(),
    );
    const nav = screen.getByRole('navigation', { name: 'Conversations' });
    await waitFor(() => expect(within(nav).getByText('hello there')).toBeTruthy());
    expect(screen.getByLabelText('Message')).toHaveProperty('value', '');
  });

  it('Shift+Enter does not send', () => {
    render(<App />);
    const box = screen.getByLabelText('Message');
    fireEvent.change(box, { target: { value: 'line one' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(chatStore.getState().messages).toHaveLength(0);
    expect(box).toHaveProperty('value', 'line one');
  });

  it('stops mid-response, keeps the partial reply, and lets you keep chatting', async () => {
    hoisted.script.current = 'slow';
    render(<App />);
    await send('write something long');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop generating' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText(/Part one/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    await waitFor(() => expect(screen.getByText('Stopped')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Stop generating' })).toBeNull();

    hoisted.script.current = 'echo';
    await send('and now?');
    await waitFor(() => expect(screen.getByText('and now?', { selector: 'p' })).toBeTruthy());
    await waitFor(() =>
      expect(chatStore.getState().messages.at(-1)?.content).toBe('Echo: **and now?**'),
    );
  });

  it('shows a friendly login message instead of a stack trace', async () => {
    hoisted.script.current = 'auth';
    render(<App />);
    await send('hi');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not logged in to Claude');
    expect(alert.textContent).toContain('claude');
    expect(alert.textContent).not.toContain('node:internal');
  });

  it('shows the usage limit with its reset time and retries', async () => {
    hoisted.script.current = 'limit';
    render(<App />);
    await send('hi');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('5-hour');
    expect(alert.textContent).toMatch(/resets at .*in 1h 59m|in 2h 0m/);

    hoisted.script.current = 'echo';
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(chatStore.getState().messages.at(-1)?.role).toBe('assistant'));
  });

  it('regenerates the last reply and edits an earlier message', async () => {
    render(<App />);
    await send('first');
    await waitFor(() => expect(chatStore.getState().messages).toHaveLength(2));

    const before = chatStore.getState().messages[1]?.id;
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate reply' }));
    // Wait for a *new* reply to finish: editing is unavailable while one streams.
    await waitFor(() => {
      const last = chatStore.getState().messages[1];
      expect(last && last.id !== before).toBe(true);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByLabelText('Edit message', { selector: 'textarea' }), {
      target: { value: 'edited' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save & resend/i }));
    await waitFor(() =>
      expect(chatStore.getState().messages.at(-1)?.content).toBe('Echo: **edited**'),
    );
    expect(chatStore.getState().messages[0]?.content).toBe('edited');
  });
});

describe('conversations', () => {
  async function chatAbout(text: string) {
    await send(text);
    await waitFor(() => expect(chatStore.getState().messages.at(-1)?.role).toBe('assistant'));
  }

  it('renames, pins, searches and deletes with confirmation', async () => {
    render(<App />);
    await chatAbout('docker question');
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }));
    await waitFor(() => expect(screen.getByText('What are we building?')).toBeTruthy());
    await chatAbout('rust question');

    const nav = screen.getByRole('navigation', { name: 'Conversations' });
    await waitFor(() => expect(within(nav).getAllByRole('listitem')).toHaveLength(2));

    // Pin the docker chat: it moves to a Pinned section.
    const dockerRow = within(nav).getByText('docker question').closest('li')!;
    fireEvent.click(within(dockerRow).getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(within(nav).getByText('Pinned')).toBeTruthy());

    // Search by message content.
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'rust' } });
    await waitFor(() => expect(within(nav).queryByText('docker question')).toBeNull());
    expect(within(nav).getByText('rust question')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: '' } });
    await waitFor(() => expect(within(nav).getByText('docker question')).toBeTruthy());

    // Rename.
    const rustRow = within(nav).getByText('rust question').closest('li')!;
    fireEvent.click(within(rustRow).getByRole('button', { name: 'Rename' }));
    const input = within(nav).getByLabelText('Conversation title');
    fireEvent.change(input, { target: { value: 'Borrow checker' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(within(nav).getByText('Borrow checker')).toBeTruthy());

    // Delete asks first; cancel keeps it, confirm removes it.
    const row = within(nav).getByText('Borrow checker').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(within(nav).getByText('Borrow checker')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(within(nav).queryByText('Borrow checker')).toBeNull());
  });
});

describe('tray and app menu', () => {
  it('opens Settings when the macOS app menu sends Settings (Cmd+,)', async () => {
    hoisted.tray.current = null;
    render(<App />);
    await waitFor(() => expect(hoisted.tray.current?.onSettings).toBeTypeOf('function'));
    expect(useUiStore.getState().view).toBe('chat');
    act(() => hoisted.tray.current!.onSettings!());
    expect(useUiStore.getState().view).toBe('settings');
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    // Choosing it again while Settings is open keeps it open.
    act(() => hoisted.tray.current!.onSettings!());
    expect(useUiStore.getState().view).toBe('settings');
  });

  it('New chat from the tray leaves Settings for the chat view', async () => {
    hoisted.tray.current = null;
    render(<App />);
    await waitFor(() => expect(hoisted.tray.current).not.toBeNull());
    act(() => hoisted.tray.current!.onSettings!());
    act(() => hoisted.tray.current!.onNewChat());
    expect(useUiStore.getState().view).toBe('chat');
  });
});
