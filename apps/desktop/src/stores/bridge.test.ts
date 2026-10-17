import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeMessage, parseRequest, type BridgeRequest } from '@command-center/protocol';
import { BridgeClient, type BridgeTransport } from '../lib/bridge';

/**
 * The store runs against a real `BridgeClient` over a fake transport shaped like the desktop one:
 * `start` returns a generation, subscriptions can be removed, pings are answered, chats stay
 * open until the test ends them, and `stop` can be made to resolve late.
 */
function fakeTransport() {
  const lines = new Set<(line: string) => void>();
  const exits = new Set<(generation?: number) => void>();
  const sent: BridgeRequest[] = [];
  const state = {
    generation: 0,
    startError: null as Error | null,
    holdStart: null as Promise<void> | null,
    holdStop: null as Promise<void> | null,
  };
  const push = (line: string) => {
    for (const h of lines) h(line);
  };
  const transport: BridgeTransport = {
    start: vi.fn(async () => {
      if (state.startError) throw state.startError;
      state.generation += 1;
      const g = state.generation;
      if (state.holdStart) await state.holdStart;
      return g;
    }),
    onLine: (h) => (lines.add(h), Promise.resolve(() => lines.delete(h))),
    onExit: (h) => (exits.add(h), Promise.resolve(() => exits.delete(h))),
    send: (line) => {
      const req = parseRequest(line);
      if (req.ok) {
        sent.push(req.value);
        const r = req.value;
        if (r.type === 'ping') {
          queueMicrotask(() =>
            push(
              encodeMessage({
                type: 'pong',
                id: r.id,
                sentAt: r.sentAt,
                protocolVersion: 2,
                bridgeVersion: '1.0.0',
              }),
            ),
          );
        }
      }
      return Promise.resolve();
    },
    stop: vi.fn(async () => {
      if (state.holdStop) await state.holdStop;
    }),
  };
  return {
    transport,
    state,
    sent,
    finishChat: (id: string) => push(encodeMessage({ type: 'chat.done', id, status: 'completed' })),
    exit: (g?: number) => {
      for (const h of [...exits]) h(g);
    },
  };
}

const hoisted = vi.hoisted(() => ({
  client: null as unknown,
  tauri: true,
}));
vi.mock('../lib/bridge-client', () => ({ getBridgeClient: () => hoisted.client }));
vi.mock('../lib/tauri', () => ({ isTauri: () => hoisted.tauri }));

const MIN = 60_000;
const chatRequest = { messages: [{ role: 'user' as const, content: 'hi' }], tools: 'off' as const };

/** A fresh store module (its idle timer and hooks are module state) over a fresh client. */
async function setup(opts: { tauri?: boolean; idle?: 0 | 5 | 10 | 30 | 60 } = {}) {
  vi.resetModules();
  hoisted.tauri = opts.tauri ?? true;
  const f = fakeTransport();
  const client = new BridgeClient(f.transport, 60 * MIN);
  hoisted.client = client;
  const { usePrefs } = await import('./prefs');
  usePrefs.getState().reset();
  if (opts.idle !== undefined) usePrefs.getState().setBridgeIdle(opts.idle);
  const mod = await import('./bridge');
  return { ...mod, usePrefs, client, f, store: () => mod.useBridgeStore.getState() };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bridge store start', () => {
  it('is unavailable outside the desktop app and never starts a bridge', async () => {
    const t = await setup({ tauri: false });
    expect(t.store().status).toBe('unavailable');
    await t.store().connect();
    expect(t.store().status).toBe('unavailable');
    expect(t.f.transport.start).not.toHaveBeenCalled();
    await expect(t.ensureBridge()).rejects.toThrow('The Claude bridge is not available.');
  });

  it('starts idle in the desktop app and does not start the bridge by itself', async () => {
    const t = await setup();
    expect(t.store().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(t.f.transport.start).not.toHaveBeenCalled();
  });

  it('starts once for concurrent callers and pings it', async () => {
    const t = await setup();
    await Promise.all([t.store().connect(), t.store().connect(), t.ensureBridge()]);
    expect(t.f.transport.start).toHaveBeenCalledOnce();
    expect(t.store()).toMatchObject({ status: 'ready', error: null });
    expect(t.store().lastPing).toMatchObject({ bridgeVersion: '1.0.0' });
    await t.store().connect();
    expect(t.f.transport.start).toHaveBeenCalledOnce();
  });

  it('ensureBridge throws the store error when the bridge cannot start', async () => {
    const t = await setup();
    t.f.state.startError = new Error('spawn failed: node not found');
    await expect(t.ensureBridge()).rejects.toThrow('spawn failed: node not found');
    expect(t.store()).toMatchObject({ status: 'error', error: 'spawn failed: node not found' });
  });
});

describe('bridge store idle stop', () => {
  it('stops after the idle minutes with nothing in flight', async () => {
    const t = await setup(); // default: 10 minutes
    await t.store().connect();
    await vi.advanceTimersByTimeAsync(10 * MIN - 1);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    expect(t.store().status).toBe('ready');
    await vi.advanceTimersByTimeAsync(1);
    expect(t.f.transport.stop).toHaveBeenCalledOnce();
    expect(t.store()).toMatchObject({ status: 'idle', lastPing: null, error: null });
  });

  it('waits another full period while a chat is still running', async () => {
    const t = await setup({ idle: 5 });
    await t.store().connect();
    const chat = t.client.chat(chatRequest, () => {});
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    // The chat ends at 10 min; the countdown restarts from there.
    t.f.finishChat(chat.id);
    await chat.done;
    await vi.advanceTimersByTimeAsync(5 * MIN - 1);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.f.transport.stop).toHaveBeenCalledOnce();
    expect(t.store().status).toBe('idle');
  });

  it('restarts the countdown after every finished request', async () => {
    const t = await setup({ idle: 10 });
    await t.store().connect();
    await vi.advanceTimersByTimeAsync(9 * MIN);
    await t.store().ping();
    await vi.advanceTimersByTimeAsync(9 * MIN);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1 * MIN);
    expect(t.f.transport.stop).toHaveBeenCalledOnce();
  });

  it('never stops when set to Never (0)', async () => {
    const t = await setup({ idle: 0 });
    await t.store().connect();
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    expect(t.store().status).toBe('ready');
  });

  it('switching to Never while ready cancels the pending stop', async () => {
    const t = await setup({ idle: 10 });
    await t.store().connect();
    await vi.advanceTimersByTimeAsync(5 * MIN);
    t.usePrefs.getState().setBridgeIdle(0);
    await vi.advanceTimersByTimeAsync(2 * 60 * MIN);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
  });

  it('a shorter length while ready restarts the countdown from now', async () => {
    const t = await setup({ idle: 10 });
    await t.store().connect();
    await vi.advanceTimersByTimeAsync(8 * MIN);
    t.usePrefs.getState().setBridgeIdle(5);
    // The old 10-minute stop is gone...
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    // ...and the new one fires 5 minutes after the change (13 min).
    await vi.advanceTimersByTimeAsync(3 * MIN - 1);
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.f.transport.stop).toHaveBeenCalledOnce();
  });

  it('changing the length while not started schedules nothing', async () => {
    const t = await setup({ idle: 10 });
    t.usePrefs.getState().setBridgeIdle(5);
    await vi.advanceTimersByTimeAsync(60 * MIN);
    expect(t.f.transport.start).not.toHaveBeenCalled();
    expect(t.f.transport.stop).not.toHaveBeenCalled();
  });
});

describe('bridge store stop and restart', () => {
  it('stop sets the status to idle synchronously', async () => {
    const t = await setup();
    await t.store().connect();
    let release!: () => void;
    t.f.state.holdStop = new Promise<void>((r) => (release = r));
    const stopping = t.store().stop();
    expect(t.store().status).toBe('idle');
    release();
    await stopping;
    expect(t.store().status).toBe('idle');
  });

  it('stop when not ready does nothing', async () => {
    const t = await setup();
    await t.store().stop();
    expect(t.f.transport.stop).not.toHaveBeenCalled();
    expect(t.store().status).toBe('idle');
  });

  it('a connect during a slow stop waits for it, then starts a fresh bridge', async () => {
    const t = await setup();
    await t.store().connect();
    let release!: () => void;
    t.f.state.holdStop = new Promise<void>((r) => (release = r));
    const stopping = t.store().stop();
    const connecting = t.store().connect();
    await flush();
    expect(t.f.transport.start).toHaveBeenCalledTimes(1);
    expect(t.store().status).toBe('idle');
    release();
    await stopping;
    await connecting;
    expect(t.f.transport.start).toHaveBeenCalledTimes(2);
    expect(t.store()).toMatchObject({ status: 'ready', error: null });
    // The fresh bridge is generation 2 and gets its own idle countdown.
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(t.f.transport.stop).toHaveBeenCalledTimes(2);
  });

  it('the exit of a bridge stopped on purpose is not reported as a crash', async () => {
    const t = await setup();
    await t.store().connect();
    await t.store().stop();
    t.f.exit(1);
    expect(t.store()).toMatchObject({ status: 'idle', error: null });
  });

  it('a late exit of the stopped bridge after a fresh start is ignored', async () => {
    const t = await setup();
    await t.store().connect();
    await t.store().stop();
    await t.store().connect();
    t.f.exit(1);
    expect(t.store()).toMatchObject({ status: 'ready', error: null });
  });

  it('a real crash is reported and the next connect restarts', async () => {
    const t = await setup();
    await t.store().connect();
    t.f.exit(1);
    expect(t.store().status).toBe('error');
    expect(t.store().error).toMatch(/stopped/);
    await t.ensureBridge();
    expect(t.f.transport.start).toHaveBeenCalledTimes(2);
    expect(t.store()).toMatchObject({ status: 'ready', error: null });
  });

  // A late exit of the stopped generation, arriving while the next start is in flight, is ignored
  // by the client, and becoming ready clears any earlier error.
  it('a late exit during the next start leaves no error behind', async () => {
    const t = await setup();
    await t.store().connect();
    await t.store().stop();
    let release!: () => void;
    t.f.state.holdStart = new Promise<void>((r) => (release = r));
    const connecting = t.store().connect();
    await flush();
    t.f.exit(1);
    release();
    await connecting;
    expect(t.store()).toMatchObject({ status: 'ready', error: null });
  });
});
