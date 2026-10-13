import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, encodeMessage, parseEvent, parseRequest, type PongEvent } from './index';

describe('protocol', () => {
  it('encodes exactly one line per message', () => {
    const line = encodeMessage({ type: 'ping', id: 'a', sentAt: 1 });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().includes('\n')).toBe(false);
  });

  it('round-trips a ping request', () => {
    const line = encodeMessage({ type: 'ping', id: 'a', sentAt: 5 });
    expect(parseRequest(line)).toEqual({ ok: true, value: { type: 'ping', id: 'a', sentAt: 5 } });
  });

  it('round-trips a pong event', () => {
    const pong: PongEvent = {
      type: 'pong',
      id: 'a',
      sentAt: 5,
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: '0.1.0',
    };
    expect(parseEvent(encodeMessage(pong))).toEqual({ ok: true, value: pong });
  });

  it('rejects malformed input without throwing', () => {
    expect(parseRequest('not json')).toMatchObject({
      ok: false,
      error: { code: 'invalid_message' },
    });
    expect(parseRequest('[]')).toMatchObject({ ok: false, error: { code: 'invalid_message' } });
    expect(parseRequest('{"type":"ping"}')).toMatchObject({ ok: false });
  });

  it('flags unknown request types', () => {
    expect(parseRequest('{"type":"nope","id":"x"}')).toMatchObject({
      ok: false,
      error: { code: 'unknown_request' },
    });
  });

  it('parses error events with and without an id', () => {
    const withId = parseEvent(
      '{"type":"error","id":"x","error":{"code":"internal","message":"m"}}',
    );
    expect(withId).toMatchObject({ ok: true, value: { id: 'x' } });
    const noId = parseEvent('{"type":"error","error":{"code":"internal","message":"m"}}');
    expect(noId.ok && 'id' in noId.value).toBe(false);
  });
});
