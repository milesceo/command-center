import {
  PROTOCOL_VERSION,
  parseRequest,
  type BridgeEvent,
  type BridgeRequest,
  type ChatRequest,
} from '@programish/protocol';
import { runChat } from './chat';
import { runUsage } from './usage-report';
import { fromThrown } from './errors';
import type { QueryFn } from './sdk';

export const BRIDGE_VERSION = '0.3.0';

export interface BridgeDeps {
  /** Resolves the SDK `query`; called per chat so load failures are reportable. */
  getQuery: () => Promise<QueryFn>;
  emit: (event: BridgeEvent) => void;
}

/**
 * Request dispatcher. Owns the set of in-flight chats so `cancel` can find
 * them. Holds no other state: conversation history lives in the app.
 */
export class Bridge {
  private readonly active = new Map<string, AbortController>();

  constructor(private readonly deps: BridgeDeps) {}

  /** Handle one raw stdin line. Never throws: bad input becomes an `error` event. */
  handleLine(line: string): void {
    const parsed = parseRequest(line);
    if (!parsed.ok) {
      this.deps.emit({ type: 'error', error: parsed.error });
      return;
    }
    void this.dispatch(parsed.value);
  }

  /** Resolves when every in-flight chat has finished (used by tests and shutdown). */
  async idle(): Promise<void> {
    while (this.active.size > 0) await new Promise((r) => setTimeout(r, 5));
  }

  abortAll(): void {
    for (const controller of this.active.values()) controller.abort();
  }

  private async dispatch(request: BridgeRequest): Promise<void> {
    switch (request.type) {
      case 'ping':
        this.deps.emit({
          type: 'pong',
          id: request.id,
          sentAt: request.sentAt,
          protocolVersion: PROTOCOL_VERSION,
          bridgeVersion: BRIDGE_VERSION,
        });
        return;
      case 'cancel':
        // Unknown ids are normal: the chat may have finished a moment earlier.
        this.active.get(request.targetId)?.abort();
        return;
      case 'chat':
        await this.startChat(request);
        return;
      case 'usage':
        await this.readUsage(request.id);
        return;
    }
  }

  private async readUsage(id: string): Promise<void> {
    try {
      const query = await this.deps.getQuery();
      await runUsage({ query, emit: this.deps.emit }, id);
    } catch (err) {
      this.deps.emit({
        type: 'error',
        id,
        error: { ...fromThrown(err), code: 'sdk_unavailable' },
      });
    }
  }

  private async startChat(request: ChatRequest): Promise<void> {
    if (this.active.has(request.id)) {
      this.deps.emit({
        type: 'error',
        id: request.id,
        error: { code: 'busy', message: 'A chat with this id is already running.' },
      });
      return;
    }
    const controller = new AbortController();
    this.active.set(request.id, controller);
    try {
      let query: QueryFn;
      try {
        query = await this.deps.getQuery();
      } catch (err) {
        this.deps.emit({
          type: 'error',
          id: request.id,
          error: { ...fromThrown(err), code: 'sdk_unavailable' },
        });
        return;
      }
      await runChat({ query, emit: this.deps.emit }, request, controller);
    } finally {
      this.active.delete(request.id);
    }
  }
}
