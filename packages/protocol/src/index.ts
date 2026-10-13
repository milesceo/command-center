/**
 * Wire protocol between the Programish desktop app and the bridge sidecar.
 *
 * Transport: newline-delimited JSON (one JSON object per line) over the
 * sidecar's stdin/stdout. stderr is reserved for human-readable logs and is
 * never parsed. Source-only package: consumers compile it directly.
 */

/** Bumped on any breaking wire change so a stale sidecar can be detected. */
export const PROTOCOL_VERSION = 1;

/** Messages the app sends to the bridge. Every request carries a unique `id`. */
export type BridgeRequest = PingRequest;

export interface PingRequest {
  type: 'ping';
  id: string;
  /** Client clock in ms; echoed back so the UI can show round-trip latency. */
  sentAt: number;
}

/** Messages the bridge sends to the app. Stream events reference the request `id`. */
export type BridgeEvent = PongEvent | ErrorEvent;

export interface PongEvent {
  type: 'pong';
  /** Id of the ping this answers. */
  id: string;
  sentAt: number;
  protocolVersion: number;
  bridgeVersion: string;
}

export interface ErrorEvent {
  type: 'error';
  /** Request id when the error relates to one; absent for unparseable input. */
  id?: string;
  error: BridgeError;
}

export type BridgeErrorCode = 'invalid_message' | 'unknown_request' | 'internal';

export interface BridgeError {
  code: BridgeErrorCode;
  message: string;
}

/** Serialize a message as a single NDJSON line (including trailing newline). */
export function encodeMessage(message: BridgeRequest | BridgeEvent): string {
  return `${JSON.stringify(message)}\n`;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: BridgeError };

function parseObject(line: string): ParseResult<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return fail('invalid_message', 'Message is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('invalid_message', 'Message must be a JSON object.');
  }
  return { ok: true, value: raw as Record<string, unknown> };
}

function fail(code: BridgeErrorCode, message: string): { ok: false; error: BridgeError } {
  return { ok: false, error: { code, message } };
}

/** Validate one line received by the bridge. Never throws. */
export function parseRequest(line: string): ParseResult<BridgeRequest> {
  const parsed = parseObject(line);
  if (!parsed.ok) return parsed;
  const { type, id, sentAt } = parsed.value;
  if (typeof id !== 'string' || id.length === 0) {
    return fail('invalid_message', 'Request is missing a string `id`.');
  }
  if (type === 'ping') {
    if (typeof sentAt !== 'number') {
      return fail('invalid_message', 'Ping is missing a numeric `sentAt`.');
    }
    return { ok: true, value: { type, id, sentAt } };
  }
  return fail('unknown_request', `Unknown request type: ${String(type)}`);
}

/** Validate one line received by the app. Never throws. */
export function parseEvent(line: string): ParseResult<BridgeEvent> {
  const parsed = parseObject(line);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.type === 'pong' && typeof v.id === 'string' && typeof v.sentAt === 'number') {
    if (typeof v.protocolVersion !== 'number' || typeof v.bridgeVersion !== 'string') {
      return fail('invalid_message', 'Pong is missing version fields.');
    }
    return {
      ok: true,
      value: {
        type: 'pong',
        id: v.id,
        sentAt: v.sentAt,
        protocolVersion: v.protocolVersion,
        bridgeVersion: v.bridgeVersion,
      },
    };
  }
  if (v.type === 'error' && typeof v.error === 'object' && v.error !== null) {
    const e = v.error as Partial<BridgeError>;
    if (typeof e.code === 'string' && typeof e.message === 'string') {
      const event: ErrorEvent = { type: 'error', error: { code: e.code, message: e.message } };
      if (typeof v.id === 'string') event.id = v.id;
      return { ok: true, value: event };
    }
  }
  return fail('invalid_message', 'Unrecognized event shape.');
}
