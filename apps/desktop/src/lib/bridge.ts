import {
  encodeMessage,
  parseEvent,
  type BridgeEvent,
  type PingRequest,
  type PongEvent,
} from '@programish/protocol';

/** The raw line channel to the sidecar. Tauri implements it; tests fake it. */
export interface BridgeTransport {
  start(): Promise<void>;
  send(line: string): Promise<void>;
  /** Subscribe to stdout lines. Returns an unsubscribe function. */
  onLine(handler: (line: string) => void): Promise<() => void>;
}

export interface PingResult {
  latencyMs: number;
  bridgeVersion: string;
  protocolVersion: number;
}

interface Pending {
  resolve: (event: BridgeEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Request/response layer over a line transport. Responses are matched to
 * requests by `id`; unmatched events go to `subscribe` listeners (this is
 * where streamed chat events will arrive in later phases).
 */
export class BridgeClient {
  private pending = new Map<string, Pending>();
  private listeners = new Set<(event: BridgeEvent) => void>();
  private unlisten: (() => void) | undefined;

  constructor(
    private readonly transport: BridgeTransport,
    private readonly timeoutMs = 5000,
  ) {}

  async connect(): Promise<void> {
    // Subscribe before starting so the sidecar's first output can't be missed.
    this.unlisten = await this.transport.onLine((line) => this.handleLine(line));
    await this.transport.start();
  }

  disconnect(): void {
    this.unlisten?.();
    this.unlisten = undefined;
  }

  subscribe(listener: (event: BridgeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async ping(): Promise<PingResult> {
    const request: PingRequest = { type: 'ping', id: crypto.randomUUID(), sentAt: Date.now() };
    const event = await this.request(request.id, encodeMessage(request));
    if (event.type !== 'pong') throw new Error(`Unexpected reply: ${event.type}`);
    return toPingResult(event);
  }

  private request(id: string, line: string): Promise<BridgeEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Bridge did not respond in time.'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(line).catch((err: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private handleLine(line: string): void {
    const parsed = parseEvent(line);
    if (!parsed.ok) {
      console.warn('[bridge] dropped unparseable line:', parsed.error.message);
      return;
    }
    const event = parsed.value;
    const pending = event.id === undefined ? undefined : this.pending.get(event.id);
    if (pending && event.id !== undefined) {
      clearTimeout(pending.timer);
      this.pending.delete(event.id);
      if (event.type === 'error') pending.reject(new Error(event.error.message));
      else pending.resolve(event);
      return;
    }
    for (const listener of this.listeners) listener(event);
  }
}

function toPingResult(pong: PongEvent): PingResult {
  return {
    latencyMs: Math.max(0, Date.now() - pong.sentAt),
    bridgeVersion: pong.bridgeVersion,
    protocolVersion: pong.protocolVersion,
  };
}
