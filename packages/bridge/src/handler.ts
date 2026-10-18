import {
  PROTOCOL_VERSION,
  parseRequest,
  type BridgeEvent,
  type BridgeRequest,
  type ChatRequest,
  type ProviderId,
  type LocalRunRequest,
} from '@command-center/protocol';
import { fromThrown } from './errors';
import {
  defaultSpawn,
  primeLoginShellPath,
  type GuiPathDeps,
  type SpawnFn,
} from './providers/process';
import { createRegistry, describeProviders, providerFor } from './providers/registry';
import type { ChatHandle, Provider, ProviderContext } from './providers/types';
import type { QueryFn } from './sdk';

export const BRIDGE_VERSION = '0.4.0';

export interface BridgeDeps {
  /** Resolves the SDK `query`; called per Claude chat so load failures are reportable. */
  getQuery: () => Promise<QueryFn>;
  emit: (event: BridgeEvent) => void;
  /** Test seams; the defaults are the real process, network and environment. */
  spawn?: SpawnFn;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** macOS PATH discovery; tests pass a stub so no real login shell runs. */
  gui?: GuiPathDeps;
  /** Extra provider adapters (tests, future providers). */
  providers?: readonly Provider[];
}

/**
 * Request dispatcher. Owns the set of in-flight chats so `cancel` can find
 * them. Holds no other state: conversation history lives in the app, and every
 * provider is reached through the `Provider` interface.
 */
export class Bridge {
  private readonly active = new Map<string, ChatHandle>();
  private readonly registry: ReadonlyMap<ProviderId, Provider>;
  private readonly ctx: ProviderContext;
  private readonly guiReady: Promise<void>;

  constructor(private readonly deps: BridgeDeps) {
    this.registry = createRegistry(deps.providers);
    this.ctx = {
      emit: deps.emit,
      getQuery: deps.getQuery,
      spawn: deps.spawn ?? defaultSpawn,
      fetch: deps.fetch ?? fetch,
      env: deps.env ?? process.env,
      platform: deps.platform ?? process.platform,
      ...(deps.gui ? { gui: deps.gui } : {}),
    };
    // On macOS, read the login shell's PATH in the background from the start. Provider reports,
    // sign-in and usage wait for it (at most a few seconds); pings never do, and neither does a
    // chat, so a cancel sent right after it is never lost (an early chat still finds CLIs in the
    // Homebrew, npm and nvm folders, and the login PATH is merged in once it is known).
    this.guiReady =
      this.ctx.platform === 'darwin' && !deps.gui
        ? primeLoginShellPath(this.ctx.env)
        : Promise.resolve();
  }

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
    for (const handle of this.active.values()) handle.cancel();
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
        this.active.get(request.targetId)?.cancel();
        return;
      case 'chat':
        await this.startChat(request);
        return;
      case 'usage':
        await this.guiReady;
        await this.readUsage(request.id);
        return;
      case 'providers':
        await this.guiReady;
        await this.report(request.id, request.hasKey);
        return;
      case 'provider.login':
        await this.guiReady;
        await this.login(request.id, request.provider);
        return;
      case 'local.run':
        await this.guiReady;
        await this.runLocal(request);
        return;
    }
  }

  private async readUsage(id: string): Promise<void> {
    const provider = providerFor(this.registry, 'claude');
    if (!provider.usage) {
      this.deps.emit({
        type: 'error',
        id,
        error: { code: 'internal', message: 'Usage reporting is not available.' },
      });
      return;
    }
    await provider.usage(id, this.ctx);
  }

  /** Opens a terminal serving a local model, then answers with a fresh report. */
  private async runLocal(request: LocalRunRequest): Promise<void> {
    const provider = providerFor(this.registry, 'local');
    try {
      if (!provider.run) throw new Error('Local models are not available.');
      await provider.run(request, this.ctx);
    } catch (err) {
      this.deps.emit({
        type: 'error',
        id: request.id,
        error: { ...fromThrown(err), code: 'invalid_request' },
      });
      return;
    }
    await this.report(request.id);
  }

  private async report(id: string, hasKey?: readonly ProviderId[]): Promise<void> {
    const providers = await describeProviders(this.registry, this.ctx, hasKey);
    this.deps.emit({ type: 'providers.report', id, providers });
  }

  private async login(id: string, providerId: ProviderId): Promise<void> {
    const provider = providerFor(this.registry, providerId);
    if (!provider.login) {
      this.deps.emit({
        type: 'error',
        id,
        error: { code: 'invalid_request', message: `${provider.displayName} has no sign-in step.` },
      });
      return;
    }
    try {
      await provider.login(this.ctx);
    } catch (err) {
      this.deps.emit({
        type: 'error',
        id,
        error: { ...fromThrown(err), code: 'sdk_unavailable' },
      });
      return;
    }
    await this.report(id);
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
    const provider = providerFor(this.registry, request.provider);
    // Reserve the id before any await so a duplicate request is refused immediately.
    let handle: ChatHandle | undefined;
    let cancelled = false;
    this.active.set(request.id, {
      done: Promise.resolve(),
      cancel: () => {
        cancelled = true;
        handle?.cancel();
      },
    });
    try {
      handle = provider.chat(request, this.ctx);
      if (cancelled) handle.cancel();
      await handle.done;
    } finally {
      this.active.delete(request.id);
    }
  }
}
