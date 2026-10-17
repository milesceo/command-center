import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (e: { payload: unknown }) => void;
const hoisted = vi.hoisted(() => ({
  tauri: { current: true },
  handlers: new Map<string, Handler>(),
  unlisten: new Map<string, ReturnType<typeof vi.fn>>(),
  listen: vi.fn(),
}));

vi.mock('./tauri', () => ({ isTauri: () => hoisted.tauri.current }));
vi.mock('@tauri-apps/api/event', () => ({ listen: hoisted.listen }));

const { listenToTray } = await import('./system');

const emit = (event: string, payload: unknown = null) => {
  const handler = hoisted.handlers.get(event);
  if (!handler) throw new Error(`nothing listens to ${event}`);
  handler({ payload });
};

const handlers = () => ({
  onNewChat: vi.fn(),
  onLock: vi.fn(),
  onVisibility: vi.fn(),
  onSettings: vi.fn(),
});

beforeEach(() => {
  hoisted.tauri.current = true;
  hoisted.handlers.clear();
  hoisted.unlisten.clear();
  hoisted.listen.mockReset();
  hoisted.listen.mockImplementation((event: string, handler: Handler) => {
    hoisted.handlers.set(event, handler);
    const off = vi.fn();
    hoisted.unlisten.set(event, off);
    return Promise.resolve(off);
  });
});

describe('listenToTray', () => {
  it('routes the macOS app menu Settings event to onSettings only', async () => {
    const h = handlers();
    await listenToTray(h);
    emit('command-center://settings');
    expect(h.onSettings).toHaveBeenCalledTimes(1);
    expect(h.onNewChat).not.toHaveBeenCalled();
    expect(h.onLock).not.toHaveBeenCalled();
    expect(h.onVisibility).not.toHaveBeenCalled();
  });

  it('routes the tray events to their handlers', async () => {
    const h = handlers();
    await listenToTray(h);
    emit('command-center://new-chat');
    emit('command-center://lock');
    emit('command-center://window-visible', false);
    emit('command-center://window-visible', true);
    expect(h.onNewChat).toHaveBeenCalledTimes(1);
    expect(h.onLock).toHaveBeenCalledTimes(1);
    expect(h.onVisibility.mock.calls).toEqual([[false], [true]]);
    expect(h.onSettings).not.toHaveBeenCalled();
  });

  it('accepts handlers without onSettings (Windows and Linux) and ignores the event', async () => {
    const { onNewChat, onLock, onVisibility } = handlers();
    await listenToTray({ onNewChat, onLock, onVisibility });
    expect(() => emit('command-center://settings')).not.toThrow();
  });

  it('unsubscribes every listener, the settings one included', async () => {
    const off = await listenToTray(handlers());
    expect([...hoisted.unlisten.keys()].sort()).toEqual([
      'command-center://lock',
      'command-center://new-chat',
      'command-center://settings',
      'command-center://window-visible',
    ]);
    off();
    for (const fn of hoisted.unlisten.values()) expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is a no-op outside the desktop app', async () => {
    hoisted.tauri.current = false;
    const off = await listenToTray(handlers());
    expect(hoisted.listen).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
  });
});
