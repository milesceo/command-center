import {
  encodeMessage,
  isTerminalEvent,
  parseEvent,
  type BridgeEvent,
  type CancelRequest,
  type ChatRequest,
  type PingRequest,
  type PongEvent,
  type ProviderId,
  type ProviderInfo,
  type ProviderLoginRequest,
  type ProvidersRequest,
  type UsageReportEvent,
  type UsageRequest,
} from '@command-center/protocol';

/** The raw line channel to the sidecar. Tauri implements it; tests fake it. */
export interface BridgeTransport {
  /** Starts the sidecar; the desktop transport returns its generation (see `onExit`). */
  start(): Promise<number | void>;
  send(line: string): Promise<void>;
  /** Subscribe to stdout lines. Returns an unsubscribe function. */
  onLine(handler: (line: string) => void): Promise<() => void>;
  /** Subscribe to the sidecar process ending; `generation` says which start it was. */
  onExit(handler: (generation?: number) => void): Promise<() => void>;
  /** Stops the sidecar on purpose (idle shutdown). Absent where the process cannot be stopped. */
  stop?(): Promise<void>;
}

export interface PingResult {
  latencyMs: number;
  bridgeVersion: string;
  protocolVersion: number;
}

/** Handle for a running chat. `done` resolves after the terminal event was delivered. */
export interface ChatHandle {
  id: string;
  cancel(): void;
  done: Promise<void>;
}

interface Pending {
  resolve: (event: BridgeEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Stream {
  onEvent: (event: BridgeEvent) => void;
  finish: () => void;
}

/** Reading plan usage starts a runtime process, which is slower than a ping. */
const USAGE_TIMEOUT_MS = 35_000;
/** Provider checks spawn each provider's CLI to ask about its login. */
const PROVIDERS_TIMEOUT_MS = 30_000;

const EXIT_MESSAGE = 'The Claude bridge process exited unexpectedly.';

/**
 * Request/response and streaming layer over a line transport. Events are
 * routed by request `id`: one-shot requests (ping) resolve a promise, chats
 * deliver every event to their handler until the terminal one.
 */
export class BridgeClient {
  private pending = new Map<string, Pending>();
  private streams = new Map<string, Stream>();
  private exitListeners = new Set<() => void>();
  private settledListeners = new Set<() => void>();
  /** The running sidecar's generation; an exit for any other one is stale and ignored. */
  private generation: number | undefined;
  /** The newest generation stopped on purpose; its exit (or an older one's) can arrive late. */
  private stoppedGeneration: number | undefined;
  private unlisten: (() => void)[] = [];

  constructor(
    private readonly transport: BridgeTransport,
    private readonly timeoutMs = 5000,
  ) {}

  async connect(): Promise<void> {
    // Subscribe before starting so the sidecar's first output can't be missed.
    this.disconnect();
    this.unlisten.push(await this.transport.onLine((line) => this.handleLine(line)));
    this.unlisten.push(await this.transport.onExit((g) => this.handleExit(g)));
    const generation = await this.transport.start();
    this.generation = typeof generation === 'number' ? generation : undefined;
  }

  disconnect(): void {
    this.unlisten.forEach((off) => off());
    this.unlisten = [];
  }

  /** True while a request is waiting for its answer or a chat is streaming. */
  isBusy(): boolean {
    return this.pending.size > 0 || this.streams.size > 0;
  }

  /** Called whenever a request or chat finishes (the idle timer restarts from there). */
  onSettled(listener: () => void): () => void {
    this.settledListeners.add(listener);
    return () => this.settledListeners.delete(listener);
  }

  /** Stops the sidecar on purpose; the next `connect` starts a fresh one. */
  async stop(): Promise<void> {
    this.stoppedGeneration = this.generation;
    this.disconnect();
    await this.transport.stop?.();
  }

  private settled(): void {
    for (const listener of this.settledListeners) listener();
  }

  /** Called when the sidecar dies; in-flight work has already been failed by then. */
  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async ping(): Promise<PingResult> {
    const request: PingRequest = { type: 'ping', id: crypto.randomUUID(), sentAt: Date.now() };
    const event = await this.request(request.id, encodeMessage(request));
    if (event.type !== 'pong') throw new Error(`Unexpected reply: ${event.type}`);
    return toPingResult(event);
  }

  /** Reads the plan usage windows (the bridge starts a short-lived runtime for this, about 2 s). */
  async usage(): Promise<UsageReportEvent> {
    const request: UsageRequest = { type: 'usage', id: crypto.randomUUID() };
    const event = await this.request(request.id, encodeMessage(request), USAGE_TIMEOUT_MS);
    if (event.type !== 'usage.report') throw new Error(`Unexpected reply: ${event.type}`);
    return event;
  }

  /** Which providers are usable now. `hasKey` lists those the app already holds an API key for. */
  async providers(hasKey: ProviderId[] = []): Promise<ProviderInfo[]> {
    const request: ProvidersRequest = {
      type: 'providers',
      id: crypto.randomUUID(),
      ...(hasKey.length > 0 ? { hasKey } : {}),
    };
    // Checking each CLI's login state can take a few seconds.
    const event = await this.request(request.id, encodeMessage(request), PROVIDERS_TIMEOUT_MS);
    if (event.type !== 'providers.report') throw new Error(`Unexpected reply: ${event.type}`);
    return event.providers;
  }

  /** Opens the provider's official sign-in in a terminal window; resolves with a fresh report. */
  async loginProvider(provider: ProviderId): Promise<ProviderInfo[]> {
    const request: ProviderLoginRequest = {
      type: 'provider.login',
      id: crypto.randomUUID(),
      provider,
    };
    const event = await this.request(request.id, encodeMessage(request), PROVIDERS_TIMEOUT_MS);
    if (event.type !== 'providers.report') throw new Error(`Unexpected reply: ${event.type}`);
    return event.providers;
  }

  /**
   * Starts a chat. Every event for it goes to `onEvent`, ending with exactly
   * one terminal event, which is also synthesized if the bridge dies or the
   * request cannot be written.
   */
  chat(
    request: Omit<ChatRequest, 'type' | 'id'>,
    onEvent: (event: BridgeEvent) => void,
  ): ChatHandle {
    const id = crypto.randomUUID();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    this.streams.set(id, { onEvent, finish });

    const message: ChatRequest = { type: 'chat', id, ...request };
    this.transport.send(encodeMessage(message)).catch((err: unknown) => {
      this.failStream(id, err instanceof Error ? err.message : String(err));
    });

    return {
      id,
      done,
      cancel: () => {
        const cancel: CancelRequest = { type: 'cancel', id: crypto.randomUUID(), targetId: id };
        this.transport.send(encodeMessage(cancel)).catch(() => undefined);
      },
    };
  }

  private request(id: string, line: string, timeoutMs = this.timeoutMs): Promise<BridgeEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Bridge did not respond in time.'));
        this.settled();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(line).catch((err: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
        this.settled();
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
    if (event.id === undefined) {
      console.warn(
        '[bridge] error without request id:',
        event.type === 'error' ? event.error.message : '',
      );
      return;
    }

    const stream = this.streams.get(event.id);
    if (stream) {
      if (isTerminalEvent(event)) this.streams.delete(event.id);
      stream.onEvent(event);
      if (isTerminalEvent(event)) {
        stream.finish();
        this.settled();
      }
      return;
    }

    const pending = this.pending.get(event.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(event.id);
      if (event.type === 'error') pending.reject(new Error(event.error.message));
      else pending.resolve(event);
      this.settled();
    }
  }

  private failStream(id: string, message: string): void {
    const stream = this.streams.get(id);
    if (!stream) return;
    this.streams.delete(id);
    stream.onEvent({ type: 'error', id, error: { code: 'internal', message } });
    stream.finish();
    this.settled();
  }

  private handleExit(generation?: number): void {
    // A bridge stopped on purpose can report its exit late: after a fresh one started, or even
    // while it is still starting (before its own generation is known).
    if (generation !== undefined) {
      if (this.stoppedGeneration !== undefined && generation <= this.stoppedGeneration) return;
      if (this.generation !== undefined && generation !== this.generation) return;
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(EXIT_MESSAGE));
      this.pending.delete(id);
    }
    for (const id of [...this.streams.keys()]) this.failStream(id, EXIT_MESSAGE);
    for (const listener of this.exitListeners) listener();
  }
}

function toPingResult(pong: PongEvent): PingResult {
  return {
    latencyMs: Math.max(0, Date.now() - pong.sentAt),
    bridgeVersion: pong.bridgeVersion,
    protocolVersion: pong.protocolVersion,
  };
}
