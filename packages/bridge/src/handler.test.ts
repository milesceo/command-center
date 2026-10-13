import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@programish/protocol';
import { BRIDGE_VERSION, handleLine } from './handler';

describe('handleLine', () => {
  it('answers ping with pong', () => {
    const [event] = handleLine('{"type":"ping","id":"1","sentAt":42}');
    expect(event).toEqual({
      type: 'pong',
      id: '1',
      sentAt: 42,
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: BRIDGE_VERSION,
    });
  });

  it('turns garbage into an error event instead of throwing', () => {
    const [event] = handleLine('garbage');
    expect(event).toMatchObject({ type: 'error', error: { code: 'invalid_message' } });
  });
});
