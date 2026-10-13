import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeMessage, parseRequest } from '@programish/protocol';
import { BridgeClient, type BridgeTransport } from './bridge';

/** In-memory transport that answers pings like the real sidecar would. */
function fakeTransport(mode: 'pong' | 'error' | 'silent'): BridgeTransport {
  let handler: (line: string) => void = () => {};
  return {
    start: () => Promise.resolve(),
    onLine: (h) => {
      handler = h;
      return Promise.resolve(() => {});
    },
    send: (line) => {
      const req = parseRequest(line);
      if (!req.ok || mode === 'silent') return Promise.resolve();
      queueMicrotask(() =>
        handler(
          mode === 'pong'
            ? encodeMessage({
                type: 'pong',
                id: req.value.id,
                sentAt: req.value.type === 'ping' ? req.value.sentAt : 0,
                protocolVersion: 1,
                bridgeVersion: '9.9.9',
              })
            : encodeMessage({
                type: 'error',
                id: req.value.id,
                error: { code: 'internal', message: 'boom' },
              }),
        ),
      );
      return Promise.resolve();
    },
  };
}

describe('BridgeClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves ping with the pong details', async () => {
    const client = new BridgeClient(fakeTransport('pong'));
    await client.connect();
    await expect(client.ping()).resolves.toMatchObject({
      bridgeVersion: '9.9.9',
      protocolVersion: 1,
    });
  });

  it('rejects when the bridge replies with an error', async () => {
    const client = new BridgeClient(fakeTransport('error'));
    await client.connect();
    await expect(client.ping()).rejects.toThrow('boom');
  });

  it('times out when the bridge stays silent', async () => {
    const client = new BridgeClient(fakeTransport('silent'), 1000);
    await client.connect();
    const result = client.ping();
    const assertion = expect(result).rejects.toThrow('did not respond');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
