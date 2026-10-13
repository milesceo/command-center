import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  encodeMessage,
  isTerminalEvent,
  parseEvent,
  type BridgeEvent,
  type BridgeRequest,
} from '@programish/protocol';

// Runs the built sidecar as a real process: the same wiring Tauri uses, with a
// fake SDK module standing in for the (login-requiring) Claude runtime.
const entry = fileURLToPath(new URL('../dist/main.mjs', import.meta.url));
const fakeSdk = fileURLToPath(new URL('../test/fake-sdk.mjs', import.meta.url));

function startBridge() {
  const child = spawn(process.execPath, [entry], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, PROGRAMISH_QUERY_MODULE: fakeSdk },
  });
  const events: BridgeEvent[] = [];
  let buf = '';
  const waiters: (() => void)[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const parsed = parseEvent(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (parsed.ok) events.push(parsed.value);
    }
    waiters.splice(0).forEach((w) => w());
  });
  return {
    events,
    send: (r: BridgeRequest) => child.stdin.write(encodeMessage(r)),
    async until(predicate: (events: BridgeEvent[]) => boolean) {
      while (!predicate(events)) await new Promise<void>((r) => waiters.push(r));
    },
    stop: () => child.stdin.end(),
  };
}

const chat = (id: string, content: string): BridgeRequest => ({
  type: 'chat',
  id,
  messages: [{ role: 'user', content }],
  tools: 'off',
});

describe('bridge process', () => {
  it('completes a ping/pong round trip over stdio', async () => {
    const bridge = startBridge();
    bridge.send({ type: 'ping', id: 'e2e', sentAt: Date.now() });
    await bridge.until((e) => e.length > 0);
    bridge.stop();
    expect(bridge.events[0]).toMatchObject({ type: 'pong', id: 'e2e' });
  });

  it('streams a chat reply', async () => {
    const bridge = startBridge();
    bridge.send(chat('c1', 'hello'));
    await bridge.until((e) => e.some(isTerminalEvent));
    bridge.stop();
    const text = bridge.events.flatMap((e) => (e.type === 'chat.text' ? [e.text] : [])).join('');
    expect(text).toContain('Echo: **hello**');
    expect(bridge.events.at(-1)).toMatchObject({ type: 'chat.done', status: 'completed' });
  });

  it('reports the usage the SDK result carried, and the plan windows', async () => {
    const bridge = startBridge();
    bridge.send(chat('c1', 'hello'));
    await bridge.until((e) => e.some(isTerminalEvent));
    bridge.stop();
    const text = bridge.events.flatMap((e) => (e.type === 'chat.text' ? [e.text] : [])).join('');
    const done = bridge.events.find((e) => e.type === 'chat.done');
    expect(done).toMatchObject({
      usage: {
        inputTokens: 'hello'.length,
        outputTokens: Math.ceil(text.length / 4),
        cacheReadTokens: 1000,
        cacheCreationTokens: 200,
        models: [{ model: 'fake-model' }],
      },
    });
    const limits = bridge.events.find((e) => e.type === 'chat.limits');
    expect(limits).toMatchObject({
      windows: [{ key: 'five_hour', utilization: 0.37 }, { key: 'seven_day' }],
    });
  });

  it('answers a usage request with the plan windows', async () => {
    const bridge = startBridge();
    bridge.send({ type: 'usage', id: 'u1' });
    await bridge.until((e) => e.some((x) => x.type === 'usage.report' || x.type === 'error'));
    bridge.stop();
    expect(bridge.events[0]).toMatchObject({
      type: 'usage.report',
      id: 'u1',
      available: true,
      subscriptionType: 'max',
      windows: [
        { key: 'five_hour', utilization: 0.41 },
        { key: 'seven_day', utilization: 0.18 },
        { key: 'model:Opus', utilization: 0.63 },
      ],
    });
  });

  it('stops a running chat on cancel', async () => {
    const bridge = startBridge();
    bridge.send(chat('c1', 'slow please'));
    await bridge.until((e) => e.length >= 3);
    bridge.send({ type: 'cancel', id: 'x', targetId: 'c1' });
    await bridge.until((e) => e.some(isTerminalEvent));
    bridge.stop();
    expect(bridge.events.at(-1)).toMatchObject({ type: 'chat.done', status: 'cancelled' });
  });

  it('reports auth and usage-limit failures as friendly error codes', async () => {
    const bridge = startBridge();
    bridge.send(chat('a', 'login'));
    bridge.send(chat('b', 'limit'));
    await bridge.until((e) => e.filter(isTerminalEvent).length === 2);
    bridge.stop();
    const errors = bridge.events.filter((e) => e.type === 'error');
    expect(errors.map((e) => e.error.code).sort()).toEqual(['auth_required', 'usage_limit']);
    const limit = errors.find((e) => e.error.code === 'usage_limit');
    expect(limit?.error.resetsAt).toBeGreaterThan(Date.now());
  });
});
