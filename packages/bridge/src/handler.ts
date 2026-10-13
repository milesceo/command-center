import {
  PROTOCOL_VERSION,
  parseRequest,
  type BridgeEvent,
  type BridgeRequest,
} from '@programish/protocol';

export const BRIDGE_VERSION = '0.1.0';

/**
 * Pure request -> events mapping, kept free of I/O so it is trivially testable.
 * Later phases extend this switch (e.g. `chat` streams many events per request).
 */
export function handleRequest(request: BridgeRequest): BridgeEvent[] {
  switch (request.type) {
    case 'ping':
      return [
        {
          type: 'pong',
          id: request.id,
          sentAt: request.sentAt,
          protocolVersion: PROTOCOL_VERSION,
          bridgeVersion: BRIDGE_VERSION,
        },
      ];
  }
}

/** Handle one raw stdin line. Never throws: bad input becomes an `error` event. */
export function handleLine(line: string): BridgeEvent[] {
  const parsed = parseRequest(line);
  if (!parsed.ok) return [{ type: 'error', error: parsed.error }];
  try {
    return handleRequest(parsed.value);
  } catch (err) {
    return [
      {
        type: 'error',
        id: parsed.value.id,
        error: { code: 'internal', message: err instanceof Error ? err.message : String(err) },
      },
    ];
  }
}
