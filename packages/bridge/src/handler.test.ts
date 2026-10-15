import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, encodeMessage, type BridgeRequest } from '@geeked/protocol';
import { BRIDGE_VERSION, Bridge } from './handler';
import type { QueryFn } from './sdk';
import { collector, scripted, sdk } from './testing';

const line = (r: BridgeRequest) => encodeMessage(r);
const chat = (id: string): BridgeRequest => ({
  type: 'chat',
  id,
  messages: [{ role: 'user', content: 'hi' }],
  tools: 'off',
});

describe('Bridge', () => {
  it('answers ping with pong', () => {
    const out = collector();
    new Bridge({ getQuery: () => Promise.resolve(scripted([])), emit: out.emit }).handleLine(
      line({ type: 'ping', id: '1', sentAt: 42 }),
    );
    expect(out.events).toEqual([
      {
        type: 'pong',
        id: '1',
        sentAt: 42,
        protocolVersion: PROTOCOL_VERSION,
        bridgeVersion: BRIDGE_VERSION,
      },
    ]);
  });

  it('turns garbage into an error event instead of throwing', () => {
    const out = collector();
    new Bridge({ getQuery: () => Promise.resolve(scripted([])), emit: out.emit }).handleLine(
      'garbage',
    );
    expect(out.events[0]).toMatchObject({ type: 'error', error: { code: 'invalid_message' } });
  });

  it('runs a chat to completion', async () => {
    const out = collector();
    const bridge = new Bridge({
      getQuery: () => Promise.resolve(scripted([sdk.start(), sdk.delta('yo'), sdk.success()])),
      emit: out.emit,
    });
    bridge.handleLine(line(chat('c1')));
    await bridge.idle();
    expect(out.types).toEqual(['chat.text', 'chat.done']);
  });

  it('answers a usage request with a usage report', async () => {
    const out = collector();
    const query: QueryFn = () =>
      Object.assign((async function* () {})(), {
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
          Promise.resolve({
            subscription_type: null,
            rate_limits_available: false,
            rate_limits: null,
          } as never),
      });
    const bridge = new Bridge({ getQuery: () => Promise.resolve(query), emit: out.emit });
    bridge.handleLine(line({ type: 'usage', id: 'u1' }));
    await vi.waitFor(() => expect(out.events).toHaveLength(1));
    expect(out.events[0]).toMatchObject({ type: 'usage.report', id: 'u1', available: false });
  });

  it('cancels a running chat by id', async () => {
    const out = collector();
    const never: QueryFn = () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<never>(() => {}),
        return: () => Promise.resolve({ done: true as const, value: undefined }),
      }),
    });
    const bridge = new Bridge({ getQuery: () => Promise.resolve(never), emit: out.emit });
    bridge.handleLine(line(chat('c1')));
    await new Promise((r) => setTimeout(r, 10));
    bridge.handleLine(line({ type: 'cancel', id: 'x', targetId: 'c1' }));
    await bridge.idle();
    expect(out.events).toEqual([{ type: 'chat.done', id: 'c1', status: 'cancelled' }]);
  });

  it('ignores cancel for unknown chats', () => {
    const out = collector();
    new Bridge({ getQuery: () => Promise.resolve(scripted([])), emit: out.emit }).handleLine(
      line({ type: 'cancel', id: 'x', targetId: 'nope' }),
    );
    expect(out.events).toEqual([]);
  });

  it('rejects a second chat that reuses a running id', async () => {
    const out = collector();
    const never: QueryFn = () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<never>(() => {}),
        return: () => Promise.resolve({ done: true as const, value: undefined }),
      }),
    });
    const bridge = new Bridge({ getQuery: () => Promise.resolve(never), emit: out.emit });
    bridge.handleLine(line(chat('c1')));
    await new Promise((r) => setTimeout(r, 10));
    bridge.handleLine(line(chat('c1')));
    await new Promise((r) => setTimeout(r, 10));
    expect(out.events).toEqual([
      { type: 'error', id: 'c1', error: { code: 'busy', message: expect.any(String) } },
    ]);
    bridge.abortAll();
    await bridge.idle();
  });

  it('reports sdk_unavailable when the SDK cannot be loaded', async () => {
    const out = collector();
    const bridge = new Bridge({
      getQuery: () => Promise.reject(new Error('Cannot find package')),
      emit: out.emit,
    });
    bridge.handleLine(line(chat('c1')));
    await bridge.idle();
    expect(out.events[0]).toMatchObject({
      type: 'error',
      id: 'c1',
      error: { code: 'sdk_unavailable' },
    });
  });
});
