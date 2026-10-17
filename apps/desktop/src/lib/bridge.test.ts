import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeMessage,
  parseRequest,
  type BridgeEvent,
  type BridgeRequest,
} from '@command-center/protocol';
import { BridgeClient, type BridgeTransport } from './bridge';

/** In-memory transport; `script` decides how the fake sidecar reacts to each request. */
function fakeTransport(script: (req: BridgeRequest, push: (e: BridgeEvent) => void) => void) {
  let onLine: (line: string) => void = () => {};
  let onExit: () => void = () => {};
  const sent: BridgeRequest[] = [];
  const push = (e: BridgeEvent) => queueMicrotask(() => onLine(encodeMessage(e)));
  const transport: BridgeTransport = {
    start: () => Promise.resolve(),
    onLine: (h) => ((onLine = h), Promise.resolve(() => {})),
    onExit: (h) => ((onExit = h), Promise.resolve(() => {})),
    send: (line) => {
      const req = parseRequest(line);
      if (req.ok) {
        sent.push(req.value);
        script(req.value, push);
      }
      return Promise.resolve();
    },
  };
  return { transport, sent, push, exit: () => onExit() };
}

const chatRequest = { messages: [{ role: 'user' as const, content: 'hi' }], tools: 'off' as const };

describe('BridgeClient ping', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the pong details', async () => {
    const f = fakeTransport((req, push) => {
      if (req.type === 'ping')
        push({
          type: 'pong',
          id: req.id,
          sentAt: req.sentAt,
          protocolVersion: 2,
          bridgeVersion: '9.9.9',
        });
    });
    const client = new BridgeClient(f.transport);
    await client.connect();
    await expect(client.ping()).resolves.toMatchObject({
      bridgeVersion: '9.9.9',
      protocolVersion: 2,
    });
  });

  it('rejects on an error reply and on silence', async () => {
    const f = fakeTransport((req, push) => {
      if (req.type === 'ping')
        push({ type: 'error', id: req.id, error: { code: 'internal', message: 'boom' } });
    });
    const client = new BridgeClient(f.transport);
    await client.connect();
    await expect(client.ping()).rejects.toThrow('boom');

    const silent = new BridgeClient(fakeTransport(() => {}).transport, 1000);
    await silent.connect();
    const assertion = expect(silent.ping()).rejects.toThrow('did not respond');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});

describe('BridgeClient chat', () => {
  it('delivers events in order and resolves done on the terminal one', async () => {
    const f = fakeTransport((req, push) => {
      if (req.type !== 'chat') return;
      push({ type: 'chat.text', id: req.id, text: 'a' });
      push({ type: 'chat.text', id: req.id, text: 'b' });
      push({ type: 'chat.done', id: req.id, status: 'completed' });
    });
    const client = new BridgeClient(f.transport);
    await client.connect();
    const seen: string[] = [];
    const handle = client.chat(chatRequest, (e) => seen.push(e.type));
    await handle.done;
    expect(seen).toEqual(['chat.text', 'chat.text', 'chat.done']);
    expect(f.sent[0]).toMatchObject({ type: 'chat', id: handle.id });
  });

  it('keeps concurrent chats separate', async () => {
    const f = fakeTransport(() => {});
    const client = new BridgeClient(f.transport);
    await client.connect();
    const a: string[] = [];
    const b: string[] = [];
    const ha = client.chat(chatRequest, (e) => e.type === 'chat.text' && a.push(e.text));
    const hb = client.chat(chatRequest, (e) => e.type === 'chat.text' && b.push(e.text));
    f.push({ type: 'chat.text', id: hb.id, text: 'for b' });
    f.push({ type: 'chat.text', id: ha.id, text: 'for a' });
    await Promise.resolve();
    await Promise.resolve();
    expect([a, b]).toEqual([['for a'], ['for b']]);
  });

  it('sends a cancel naming the chat', async () => {
    const f = fakeTransport(() => {});
    const client = new BridgeClient(f.transport);
    await client.connect();
    const handle = client.chat(chatRequest, () => {});
    handle.cancel();
    expect(f.sent.at(-1)).toMatchObject({ type: 'cancel', targetId: handle.id });
  });

  it('fails in-flight chats when the sidecar exits', async () => {
    const f = fakeTransport(() => {});
    const client = new BridgeClient(f.transport);
    await client.connect();
    const exits = vi.fn();
    client.onExit(exits);
    const seen: BridgeEvent[] = [];
    const handle = client.chat(chatRequest, (e) => seen.push(e));
    f.exit();
    await handle.done;
    expect(seen).toEqual([
      { type: 'error', id: handle.id, error: { code: 'internal', message: expect.any(String) } },
    ]);
    expect(exits).toHaveBeenCalledOnce();
  });

  it('fails the chat when the request cannot be written', async () => {
    const f = fakeTransport(() => {});
    const transport = { ...f.transport, send: () => Promise.reject(new Error('pipe closed')) };
    const client = new BridgeClient(transport);
    await client.connect();
    const seen: BridgeEvent[] = [];
    await client.chat(chatRequest, (e) => seen.push(e)).done;
    expect(seen[0]).toMatchObject({ type: 'error', error: { message: 'pipe closed' } });
  });
});

/**
 * A transport like the desktop one: `start` returns a generation (or nothing, for `legacy`),
 * subscriptions can be removed, and `exit(g)` reports an exit for generation `g`.
 */
function generationTransport(opts: { legacy?: boolean; withStop?: boolean } = {}) {
  const lines = new Set<(line: string) => void>();
  const exits = new Set<(generation?: number) => void>();
  const sent: BridgeRequest[] = [];
  let generation = 0;
  let release: (() => void) | null = null;
  const stop = vi.fn(() => Promise.resolve());
  const transport: BridgeTransport = {
    start: async () => {
      generation += 1;
      const g = generation;
      if (release === null && holdStart) await new Promise<void>((r) => (release = r));
      return opts.legacy ? undefined : g;
    },
    onLine: (h) => (lines.add(h), Promise.resolve(() => lines.delete(h))),
    onExit: (h) => (exits.add(h), Promise.resolve(() => exits.delete(h))),
    send: (line) => {
      const req = parseRequest(line);
      if (req.ok) sent.push(req.value);
      return Promise.resolve();
    },
    ...(opts.withStop === false ? {} : { stop }),
  };
  let holdStart = false;
  return {
    transport,
    sent,
    stop,
    push: (e: BridgeEvent) => {
      for (const h of lines) h(encodeMessage(e));
    },
    exit: (g?: number) => {
      for (const h of [...exits]) h(g);
    },
    subscribers: () => ({ lines: lines.size, exits: exits.size }),
    /** Makes the next `start` wait until `releaseStart` is called. */
    holdNextStart: () => {
      holdStart = true;
      release = null;
    },
    releaseStart: () => {
      holdStart = false;
      const r = release as (() => void) | null;
      release = null;
      r?.();
    },
  };
}

const lastId = (sent: BridgeRequest[]) => sent.at(-1)?.id ?? '';
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('BridgeClient busy and settled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is busy while a request waits and while a chat streams', async () => {
    const f = generationTransport();
    const client = new BridgeClient(f.transport);
    await client.connect();
    expect(client.isBusy()).toBe(false);

    const ping = client.ping();
    expect(client.isBusy()).toBe(true);
    f.push({
      type: 'pong',
      id: lastId(f.sent),
      sentAt: Date.now(),
      protocolVersion: 2,
      bridgeVersion: '1',
    });
    await ping;
    expect(client.isBusy()).toBe(false);

    const chat = client.chat(chatRequest, () => {});
    expect(client.isBusy()).toBe(true);
    f.push({ type: 'chat.done', id: chat.id, status: 'completed' });
    await chat.done;
    expect(client.isBusy()).toBe(false);
  });

  it('fires onSettled for a resolved request, an error reply and a timeout', async () => {
    const f = generationTransport();
    const client = new BridgeClient(f.transport, 1000);
    await client.connect();
    const settled = vi.fn();
    client.onSettled(settled);

    const ok = client.ping();
    f.push({
      type: 'pong',
      id: lastId(f.sent),
      sentAt: Date.now(),
      protocolVersion: 2,
      bridgeVersion: '1',
    });
    await ok;
    expect(settled).toHaveBeenCalledTimes(1);

    const bad = client.ping();
    f.push({ type: 'error', id: lastId(f.sent), error: { code: 'internal', message: 'nope' } });
    await expect(bad).rejects.toThrow('nope');
    expect(settled).toHaveBeenCalledTimes(2);

    const silent = expect(client.ping()).rejects.toThrow('did not respond');
    expect(settled).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await silent;
    expect(settled).toHaveBeenCalledTimes(3);
    expect(client.isBusy()).toBe(false);
  });

  it('fires onSettled for a finished chat, a chat whose write failed and a chat cut off by an exit', async () => {
    const f = generationTransport();
    const client = new BridgeClient(f.transport);
    await client.connect();
    const settled = vi.fn();
    const off = client.onSettled(settled);

    const done = client.chat(chatRequest, () => {});
    f.push({ type: 'chat.text', id: done.id, text: 'partial' });
    expect(settled).not.toHaveBeenCalled();
    f.push({ type: 'chat.done', id: done.id, status: 'completed' });
    await done.done;
    expect(settled).toHaveBeenCalledTimes(1);

    const failing = new BridgeClient({
      ...f.transport,
      send: () => Promise.reject(new Error('pipe closed')),
    });
    await failing.connect();
    const failedSettled = vi.fn();
    failing.onSettled(failedSettled);
    await failing.chat(chatRequest, () => {}).done;
    expect(failedSettled).toHaveBeenCalledTimes(1);

    const cut = client.chat(chatRequest, () => {});
    f.exit(1);
    await cut.done;
    expect(settled).toHaveBeenCalledTimes(2);

    off();
    const after = client.chat(chatRequest, () => {});
    f.push({ type: 'chat.done', id: after.id, status: 'completed' });
    await after.done;
    expect(settled).toHaveBeenCalledTimes(2);
  });
});

describe('BridgeClient stop and stale exits', () => {
  it('stop unsubscribes from the transport and calls transport.stop', async () => {
    const f = generationTransport();
    const client = new BridgeClient(f.transport);
    await client.connect();
    expect(f.subscribers()).toEqual({ lines: 1, exits: 1 });
    await client.stop();
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.subscribers()).toEqual({ lines: 0, exits: 0 });

    // The exit of the stopped process no longer reaches the client.
    const exits = vi.fn();
    client.onExit(exits);
    f.exit(1);
    expect(exits).not.toHaveBeenCalled();
  });

  it('stop works on a transport without stop', async () => {
    const f = generationTransport({ withStop: false });
    const client = new BridgeClient(f.transport);
    await client.connect();
    await expect(client.stop()).resolves.toBeUndefined();
    expect(f.subscribers()).toEqual({ lines: 0, exits: 0 });
  });

  it('ignores an exit from an older generation and fails work on the current one', async () => {
    const f = generationTransport();
    const client = new BridgeClient(f.transport, 60_000);
    await client.connect(); // generation 1
    await client.stop();
    await client.connect(); // generation 2
    const exits = vi.fn();
    client.onExit(exits);

    const ping = client.ping();
    let rejected: unknown = null;
    ping.catch((err: unknown) => (rejected = err));
    const seen: BridgeEvent[] = [];
    const chat = client.chat(chatRequest, (e) => seen.push(e));

    f.exit(1);
    await flush();
    expect(exits).not.toHaveBeenCalled();
    expect(rejected).toBeNull();
    expect(seen).toEqual([]);
    expect(client.isBusy()).toBe(true);

    f.exit(2);
    await chat.done;
    await expect(ping).rejects.toThrow();
    expect(seen[0]).toMatchObject({ type: 'error', id: chat.id });
    expect(exits).toHaveBeenCalledOnce();
    expect(client.isBusy()).toBe(false);
  });

  it('treats any exit as the current one when start returns no generation', async () => {
    const f = generationTransport({ legacy: true });
    const client = new BridgeClient(f.transport);
    await client.connect();
    const exits = vi.fn();
    client.onExit(exits);
    const chat = client.chat(chatRequest, () => {});
    f.exit(7);
    await chat.done;
    expect(exits).toHaveBeenCalledOnce();
    f.exit();
    expect(exits).toHaveBeenCalledTimes(2);
  });

  it('treats an exit without a generation as the current one', async () => {
    const f = generationTransport();
    const client = new BridgeClient(f.transport);
    await client.connect();
    const exits = vi.fn();
    client.onExit(exits);
    f.exit();
    expect(exits).toHaveBeenCalledOnce();
  });

  // The exit of a bridge stopped on purpose can arrive while the next one is still starting
  // (before its generation is known); `stop` remembers the stopped generation so it is ignored.
  it('ignores a late exit of the stopped bridge that arrives while the next one starts', async () => {
    const f = generationTransport();
    const client = new BridgeClient(f.transport);
    await client.connect(); // generation 1
    const exits = vi.fn();
    client.onExit(exits);
    await client.stop();
    f.holdNextStart();
    const connecting = client.connect(); // generation 2, start not finished yet
    await flush();
    f.exit(1); // the old process's exit event, delivered late
    f.releaseStart();
    await connecting;
    expect(exits).not.toHaveBeenCalled();
  });
});
