import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  encodeMessage,
  isTerminalEvent,
  parseEvent,
  parseRequest,
  type BridgeEvent,
  type BridgeRequest,
} from './index';

const roundTripRequest = (r: BridgeRequest) => parseRequest(encodeMessage(r));
const roundTripEvent = (e: BridgeEvent) => parseEvent(encodeMessage(e));

describe('encoding', () => {
  it('writes exactly one line per message', () => {
    const line = encodeMessage({ type: 'ping', id: 'a', sentAt: 1 });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().includes('\n')).toBe(false);
  });

  it('keeps newlines inside strings escaped', () => {
    const line = encodeMessage({ type: 'chat.text', id: 'a', text: 'a\nb' });
    expect(line.trim().split('\n')).toHaveLength(1);
  });
});

describe('requests', () => {
  it('round-trips ping, chat and cancel', () => {
    expect(roundTripRequest({ type: 'ping', id: 'a', sentAt: 5 })).toMatchObject({ ok: true });
    const chat: BridgeRequest = {
      type: 'chat',
      id: 'c1',
      messages: [
        { role: 'user', content: 'hi', attachments: [{ name: 'a.ts', text: 'x' }] },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'again' },
      ],
      model: 'sonnet',
      systemPrompt: 'be brief',
      tools: 'readonly',
      cwd: '/repo',
    };
    expect(roundTripRequest(chat)).toEqual({ ok: true, value: chat });
    const cancel: BridgeRequest = { type: 'cancel', id: 'x', targetId: 'c1' };
    expect(roundTripRequest(cancel)).toEqual({ ok: true, value: cancel });
  });

  it('rejects malformed input without throwing', () => {
    expect(parseRequest('not json')).toMatchObject({
      ok: false,
      error: { code: 'invalid_message' },
    });
    expect(parseRequest('[]')).toMatchObject({ ok: false });
    expect(parseRequest('{"type":"ping"}')).toMatchObject({ ok: false });
  });

  it('flags unknown request types', () => {
    expect(parseRequest('{"type":"nope","id":"x"}')).toMatchObject({
      ok: false,
      error: { code: 'unknown_request' },
    });
  });

  it('validates chat structure', () => {
    const base = { type: 'chat', id: 'c', tools: 'off' };
    const parse = (extra: object) => parseRequest(JSON.stringify({ ...base, ...extra }));
    expect(parse({ messages: [] })).toMatchObject({ ok: false });
    expect(parse({ messages: [{ role: 'system', content: 'x' }] })).toMatchObject({ ok: false });
    expect(parse({ messages: [{ role: 'assistant', content: 'x' }] })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('last') },
    });
    expect(parse({ messages: [{ role: 'user', content: 'x' }], tools: 'all' })).toMatchObject({
      ok: false,
    });
    expect(
      parse({ messages: [{ role: 'user', content: 'x', attachments: [{ name: 1 }] }] }),
    ).toMatchObject({ ok: false });
  });

  it('requires a cwd for read-only tools', () => {
    const line = JSON.stringify({
      type: 'chat',
      id: 'c',
      tools: 'readonly',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(parseRequest(line)).toMatchObject({ ok: false });
  });

  it('requires a targetId on cancel', () => {
    expect(parseRequest('{"type":"cancel","id":"x"}')).toMatchObject({ ok: false });
  });
});

describe('events', () => {
  const events: BridgeEvent[] = [
    { type: 'pong', id: 'a', sentAt: 5, protocolVersion: PROTOCOL_VERSION, bridgeVersion: '0.1.0' },
    { type: 'chat.text', id: 'c', text: 'hello' },
    { type: 'chat.tool_use', id: 'c', toolUseId: 't', name: 'Read', summary: 'src/a.ts' },
    { type: 'chat.tool_result', id: 'c', toolUseId: 't', isError: false },
    {
      type: 'chat.rate_limit',
      id: 'c',
      status: 'allowed_warning',
      limitType: 'five_hour',
      resetsAt: 9,
      utilization: 0.9,
    },
    {
      type: 'chat.done',
      id: 'c',
      status: 'completed',
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 2 },
      durationMs: 10,
    },
    { type: 'chat.done', id: 'c', status: 'cancelled' },
    {
      type: 'error',
      id: 'c',
      error: { code: 'usage_limit', message: 'm', resetsAt: 5, limitType: 'five_hour' },
    },
    { type: 'error', error: { code: 'internal', message: 'm' } },
  ];

  it.each(events)('round-trips $type', (event) => {
    expect(roundTripEvent(event)).toEqual({ ok: true, value: event });
  });

  it('omits the id on errors that have none', () => {
    const parsed = parseEvent('{"type":"error","error":{"code":"internal","message":"m"}}');
    expect(parsed.ok && 'id' in parsed.value).toBe(false);
  });

  it('rejects unknown or incomplete events', () => {
    expect(parseEvent('{"type":"chat.text","id":"c"}')).toMatchObject({ ok: false });
    expect(parseEvent('{"type":"mystery","id":"c"}')).toMatchObject({ ok: false });
    expect(parseEvent('{"type":"chat.done","id":"c","status":"weird"}')).toMatchObject({
      ok: false,
    });
  });

  it('knows which events are terminal', () => {
    expect(isTerminalEvent({ type: 'chat.text', id: 'c', text: 'x' })).toBe(false);
    expect(isTerminalEvent({ type: 'chat.done', id: 'c', status: 'completed' })).toBe(true);
    expect(isTerminalEvent({ type: 'error', error: { code: 'internal', message: 'm' } })).toBe(
      true,
    );
  });
});
