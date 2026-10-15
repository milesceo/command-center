import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeMessage,
  parseRequest,
  type BridgeEvent,
  type BridgeRequest,
} from '@geeked/protocol';
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
