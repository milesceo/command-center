import type {
  BridgeEvent,
  ChatRequest,
  ProviderAuthMethod,
  ProviderAuthState,
  ProviderId,
  ProviderModel,
} from '@geeked/protocol';
import type { QueryFn } from '../sdk';
import type { SpawnFn } from './process';

/** What a provider adapter may use; everything is injectable so adapters test without a network. */
export interface ProviderContext {
  /** Sends a protocol event to the app. */
  emit: (event: BridgeEvent) => void;
  /** Loads the Claude Agent SDK `query` (only the Claude adapter calls it). */
  getQuery: () => Promise<QueryFn>;
  spawn: SpawnFn;
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

/** A running chat. `done` resolves after the terminal event was emitted; it never rejects. */
export interface ChatHandle {
  done: Promise<void>;
  /** Stops the run promptly. Safe to call after it finished. */
  cancel: () => void;
}

export interface ProviderAuth {
  state: ProviderAuthState;
  via?: ProviderAuthMethod | undefined;
  /** Short technical detail for logs/UI ("Logged in using ChatGPT"). Never a secret. */
  detail?: string | undefined;
}

/**
 * One AI provider. The app talks to every provider through this interface; the bridge picks
 * the adapter from `ChatRequest.provider`. To add a provider: implement this, add its id to
 * `PROVIDER_IDS` in the protocol package, and register it in `registry.ts`.
 *
 * Contract for `chat`: emit zero or more `chat.*` events and then exactly one terminal event
 * (`chat.done` or `error`) with the request's id, and never throw.
 */
export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;
  /** Officially supported sign-in routes, in preference order. */
  readonly authMethods: readonly ProviderAuthMethod[];
  /** Plain-language limits shown in the UI. */
  readonly note: string;

  models(): ProviderModel[];
  /** `hasKey` is true when the app holds an API key for this provider. */
  authStatus(ctx: ProviderContext, hasKey: boolean): Promise<ProviderAuth>;
  chat(request: ChatRequest, ctx: ProviderContext): ChatHandle;
  /** Opens the provider's official sign-in for the user to complete. Absent = not supported. */
  login?(ctx: ProviderContext): Promise<void>;
  /** Plan/usage reporting, for providers that expose it. Emits one `usage.report` or `error`. */
  usage?(id: string, ctx: ProviderContext): Promise<void>;
}
