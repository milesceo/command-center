/**
 * Wire protocol between the Command Center desktop app and the bridge sidecar.
 *
 * Transport: newline-delimited JSON (one JSON object per line) over the
 * sidecar's stdin/stdout. stderr is reserved for human-readable logs and is
 * never parsed. Source-only package: consumers compile it directly.
 *
 * Streaming model: a `chat` request is answered by any number of `chat.*`
 * events that all carry the request's `id`, ending with exactly one terminal
 * event: `chat.done` (completed or cancelled) or `error`.
 */

import {
  isHttpUrl,
  isLoopbackUrl,
  parseChatParams,
  parseLocalRunRequest,
  parseRuntimeStatuses,
  type ChatParams,
  type LocalRunRequest,
  type RuntimeStatus,
} from './models';

export * from './models';

/** Bumped on any breaking wire change so a stale sidecar can be detected. */
export const PROTOCOL_VERSION = 5;

/**
 * Providers Command Center can talk to. `claude` is the original and the default. `huggingface`
 * (Inference Providers, with the user's HF token) and `local` (a model server on this computer)
 * were added in protocol 5.
 */
export const PROVIDER_IDS = ['claude', 'openai', 'xai', 'huggingface', 'local'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const DEFAULT_PROVIDER: ProviderId = 'claude';

/** Model aliases understood by the Claude Code runtime ('default' = its own choice). */
export const MODEL_OPTIONS = [
  { id: 'default', label: 'Default' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
] as const;

/**
 * Tool access for a conversation. Plain chat is the default.
 * - `off`: no tools at all.
 * - `readonly`: Read/Glob/Grep inside `cwd`; anything else is denied, never prompted.
 */
export type ToolsMode = 'off' | 'readonly';

// ---------------------------------------------------------------- requests

export type BridgeRequest =
  | PingRequest
  | ChatRequest
  | CancelRequest
  | UsageRequest
  | ProvidersRequest
  | ProviderLoginRequest
  | LocalRunRequest;

export interface PingRequest {
  type: 'ping';
  id: string;
  /** Client clock in ms; echoed back so the UI can show round-trip latency. */
  sentAt: number;
}

/** A text file the user attached to a message. Binary files are rejected client-side. */
export interface Attachment {
  name: string;
  text: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

/**
 * The app owns conversation history (SQLite is the source of truth), so each
 * request carries the whole transcript. The last message must be from the user.
 */
export interface ChatRequest {
  type: 'chat';
  id: string;
  messages: ChatMessage[];
  /** Alias from MODEL_OPTIONS, or a full model id. Omitted = runtime default. */
  model?: string;
  systemPrompt?: string;
  tools: ToolsMode;
  /** Working directory for tools. Required for `readonly`. */
  cwd?: string;
  /** Which provider answers. Omitted = `claude` (the original, unchanged path). */
  provider?: ProviderId;
  /**
   * API key for providers that use one, read from the OS keychain by the app for this request
   * only. The bridge never logs, stores or echoes it.
   */
  apiKey?: string;
  /** Sampling and length settings (custom models; protocol 5). Validated on both sides. */
  params?: ChatParams;
  /**
   * The OpenAI-compatible server for the `local` provider. Must be on this computer unless
   * `allowRemote` is set (the user's explicit Settings choice).
   */
  baseUrl?: string;
  allowRemote?: boolean;
}

/** Stops the chat started by the request whose id is `targetId`. */
export interface CancelRequest {
  type: 'cancel';
  id: string;
  targetId: string;
}

/** Asks for the claude.ai plan usage windows (5-hour, weekly, ...). Answered by one `usage.report`. */
export interface UsageRequest {
  type: 'usage';
  id: string;
}

/** Asks which providers are usable right now. Answered by one `providers.report`. */
export interface ProvidersRequest {
  type: 'providers';
  id: string;
  /** Providers the app already holds an API key for (the keys themselves stay in the keychain). */
  hasKey?: ProviderId[];
}

/**
 * Opens the provider's own official CLI sign-in (a terminal window the user completes), then
 * answers with a fresh `providers.report`. Command Center never sees the credentials it creates.
 */
export interface ProviderLoginRequest {
  type: 'provider.login';
  id: string;
  provider: ProviderId;
}

// ------------------------------------------------------------------ events

export type BridgeEvent =
  | PongEvent
  | ErrorEvent
  | ChatTextEvent
  | ChatToolUseEvent
  | ChatToolResultEvent
  | ChatRateLimitEvent
  | ChatLimitsEvent
  | ChatDoneEvent
  | UsageReportEvent
  | ProvidersReportEvent;

export type ProviderAuthState =
  /** Signed in (subscription) or a key is stored. */
  | 'signed_in'
  | 'signed_out'
  /** The provider's official CLI is not installed. */
  | 'not_installed'
  /** Could not tell; the provider documents no way to check. */
  | 'unknown';

export type ProviderAuthMethod = 'subscription' | 'apiKey';

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Routes this provider officially supports, in preference order. */
  authMethods: ProviderAuthMethod[];
  auth: ProviderAuthState;
  /** Which route `auth` refers to when signed in. */
  authVia?: ProviderAuthMethod;
  models: ProviderModel[];
  /** Plain-language limits for the UI (what works, what does not). */
  note: string;
  /** The `local` provider: each runtime's install and server state (protocol 5). */
  runtimes?: RuntimeStatus[];
}

export interface ProvidersReportEvent {
  type: 'providers.report';
  id: string;
  providers: ProviderInfo[];
}

export interface PongEvent {
  type: 'pong';
  /** Id of the ping this answers. */
  id: string;
  sentAt: number;
  protocolVersion: number;
  bridgeVersion: string;
}

/** An incremental piece of the assistant's reply text. */
export interface ChatTextEvent {
  type: 'chat.text';
  id: string;
  text: string;
}

export interface ChatToolUseEvent {
  type: 'chat.tool_use';
  id: string;
  toolUseId: string;
  name: string;
  /** Short human-readable summary of the input (e.g. a file path), never the raw payload. */
  summary: string;
}

export interface ChatToolResultEvent {
  type: 'chat.tool_result';
  id: string;
  toolUseId: string;
  isError: boolean;
}

/** Non-terminal heads-up that usage is getting high. A hard stop arrives as an `error`. */
export interface ChatRateLimitEvent {
  type: 'chat.rate_limit';
  id: string;
  status: 'allowed_warning' | 'rejected';
  limitType?: string;
  /** Epoch milliseconds when the limit resets, when the runtime says. */
  resetsAt?: number;
  /** 0..1 fraction of the limit used, when known. */
  utilization?: number;
}

/** Token counts, kept separate so cached prompt tokens are never confused with fresh input. */
export interface TokenCounts {
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface ModelUsageEntry extends TokenCounts {
  /** Model id as the runtime reports it (e.g. `claude-haiku-5-5`). */
  model: string;
  /** What the SDK says these tokens would cost at API list prices; absent when it does not say. Informational, not a bill. */
  costUsd?: number;
}

/** Usage of one chat: totals plus the per-model breakdown they were summed from. */
export interface ChatUsage extends TokenCounts {
  costUsd?: number;
  models: ModelUsageEntry[];
}

/**
 * One plan usage window (rolling 5 hours, weekly, ...). `utilization` is the used
 * fraction 0..1, `resetsAt` epoch milliseconds; either is null when unknown.
 */
export interface UsageWindow {
  /** Stable id: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_oauth_apps` or `model:<name>`. */
  key: string;
  label: string;
  utilization: number | null;
  resetsAt: number | null;
}

/** Plan windows the runtime attached to a chat's rate-limit info. Informational; may be absent for some logins. */
export interface ChatLimitsEvent {
  type: 'chat.limits';
  id: string;
  windows: UsageWindow[];
}

export interface ExtraUsage {
  enabled: boolean;
  usedCredits: number | null;
  monthlyLimit: number | null;
  utilization: number | null;
  currency: string | null;
}

export interface UsageReportEvent {
  type: 'usage.report';
  id: string;
  /** False for API-key / third-party logins (and logins without profile access): no plan windows exist. */
  available: boolean;
  subscriptionType: string | null;
  windows: UsageWindow[];
  extraUsage: ExtraUsage | null;
}

export interface ChatDoneEvent {
  type: 'chat.done';
  id: string;
  status: 'completed' | 'cancelled';
  model?: string;
  usage?: ChatUsage;
  durationMs?: number;
}

export interface ErrorEvent {
  type: 'error';
  /** Request id when the error relates to one; absent for unparseable input. */
  id?: string;
  error: BridgeError;
}

export type BridgeErrorCode =
  | 'invalid_message'
  | 'unknown_request'
  | 'internal'
  /** Not logged in to Claude Code (or the login expired). */
  | 'auth_required'
  /** Subscription usage window exhausted; `resetsAt` says when it reopens. */
  | 'usage_limit'
  /** Transient request-rate throttling; retrying shortly works. */
  | 'rate_limited'
  | 'overloaded'
  /** Account-level problem: billing, org access, hold or verification. */
  | 'account'
  | 'model_not_found'
  | 'invalid_request'
  /** The Claude Code runtime could not be started. */
  | 'sdk_unavailable'
  /** A chat with this id is already running. */
  | 'busy';

export interface BridgeError {
  code: BridgeErrorCode;
  /** Technical, English description for logs and "details". Not meant as UI copy. */
  message: string;
  /** Epoch milliseconds, for `usage_limit` / `rate_limited` when known. */
  resetsAt?: number;
  /** Which window was hit (e.g. `five_hour`, `seven_day`), when known. */
  limitType?: string;
}

// ----------------------------------------------------------------- codec

/** Serialize a message as a single NDJSON line (including trailing newline). */
export function encodeMessage(message: BridgeRequest | BridgeEvent): string {
  return `${JSON.stringify(message)}\n`;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: BridgeError };

type Json = Record<string, unknown>;

function fail(code: BridgeErrorCode, message: string): { ok: false; error: BridgeError } {
  return { ok: false, error: { code, message } };
}

function parseObject(line: string): ParseResult<Json> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return fail('invalid_message', 'Message is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('invalid_message', 'Message must be a JSON object.');
  }
  return { ok: true, value: raw as Json };
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isProviderId = (v: unknown): v is ProviderId =>
  typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseAttachments(raw: unknown): Attachment[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  const out: Attachment[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isString(item.name) || !isString(item.text)) return null;
    out.push({ name: item.name, text: item.text });
  }
  return out;
}

function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    if (item.role !== 'user' && item.role !== 'assistant') return null;
    if (!isString(item.content)) return null;
    const attachments = parseAttachments(item.attachments);
    if (attachments === null) return null;
    const message: ChatMessage = { role: item.role, content: item.content };
    if (attachments) message.attachments = attachments;
    out.push(message);
  }
  return out;
}

function parseChatRequest(id: string, v: Json): ParseResult<ChatRequest> {
  const messages = parseMessages(v.messages);
  if (!messages) return fail('invalid_message', 'Chat needs a non-empty, well-formed `messages`.');
  if (messages[messages.length - 1]?.role !== 'user') {
    return fail('invalid_message', 'The last chat message must be from the user.');
  }
  if (v.tools !== 'off' && v.tools !== 'readonly') {
    return fail('invalid_message', 'Chat `tools` must be "off" or "readonly".');
  }
  const request: ChatRequest = { type: 'chat', id, messages, tools: v.tools };
  if (v.model !== undefined) {
    if (!isString(v.model)) return fail('invalid_message', '`model` must be a string.');
    request.model = v.model;
  }
  if (v.systemPrompt !== undefined) {
    if (!isString(v.systemPrompt))
      return fail('invalid_message', '`systemPrompt` must be a string.');
    request.systemPrompt = v.systemPrompt;
  }
  if (v.cwd !== undefined) {
    if (!isString(v.cwd)) return fail('invalid_message', '`cwd` must be a string.');
    request.cwd = v.cwd;
  }
  if (v.provider !== undefined) {
    if (!isProviderId(v.provider)) return fail('invalid_message', 'Unknown `provider`.');
    request.provider = v.provider;
  }
  if (v.apiKey !== undefined) {
    if (!isString(v.apiKey)) return fail('invalid_message', '`apiKey` must be a string.');
    request.apiKey = v.apiKey;
  }
  if (v.params !== undefined) {
    const params = parseChatParams(v.params);
    if (!params.ok) return fail('invalid_message', params.message);
    request.params = params.value;
  }
  if (v.allowRemote !== undefined) {
    if (typeof v.allowRemote !== 'boolean')
      return fail('invalid_message', '`allowRemote` must be a boolean.');
    request.allowRemote = v.allowRemote;
  }
  if (v.baseUrl !== undefined) {
    const ok = request.allowRemote ? isHttpUrl(v.baseUrl) : isLoopbackUrl(v.baseUrl);
    if (!ok) {
      return fail(
        'invalid_message',
        request.allowRemote
          ? '`baseUrl` must be an http(s) URL without credentials.'
          : '`baseUrl` must be on this computer (localhost) unless remote servers are allowed.',
      );
    }
    request.baseUrl = v.baseUrl as string;
  }
  if (request.tools === 'readonly' && !request.cwd) {
    return fail('invalid_message', 'Read-only tools need a working directory (`cwd`).');
  }
  return { ok: true, value: request };
}

/** Validate one line received by the bridge. Never throws. */
export function parseRequest(line: string): ParseResult<BridgeRequest> {
  const parsed = parseObject(line);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!isString(v.id) || v.id.length === 0) {
    return fail('invalid_message', 'Request is missing a string `id`.');
  }
  switch (v.type) {
    case 'ping':
      if (!isNumber(v.sentAt))
        return fail('invalid_message', 'Ping is missing a numeric `sentAt`.');
      return { ok: true, value: { type: 'ping', id: v.id, sentAt: v.sentAt } };
    case 'chat':
      return parseChatRequest(v.id, v);
    case 'usage':
      return { ok: true, value: { type: 'usage', id: v.id } };
    case 'providers': {
      const request: ProvidersRequest = { type: 'providers', id: v.id };
      if (v.hasKey !== undefined) {
        if (!Array.isArray(v.hasKey) || !v.hasKey.every(isProviderId)) {
          return fail('invalid_message', '`hasKey` must be a list of provider ids.');
        }
        request.hasKey = v.hasKey;
      }
      return { ok: true, value: request };
    }
    case 'provider.login':
      if (!isProviderId(v.provider)) return fail('invalid_message', 'Unknown `provider`.');
      return { ok: true, value: { type: 'provider.login', id: v.id, provider: v.provider } };
    case 'local.run': {
      const parsedRun = parseLocalRunRequest(v.id, v);
      return parsedRun.ok ? parsedRun : fail('invalid_message', parsedRun.message);
    }
    case 'cancel':
      if (!isString(v.targetId)) return fail('invalid_message', 'Cancel needs a `targetId`.');
      return { ok: true, value: { type: 'cancel', id: v.id, targetId: v.targetId } };
    default:
      return fail('unknown_request', `Unknown request type: ${String(v.type)}`);
  }
}

function parseBridgeError(raw: unknown): BridgeError | null {
  if (!isObject(raw) || !isString(raw.code) || !isString(raw.message)) return null;
  const error: BridgeError = { code: raw.code as BridgeErrorCode, message: raw.message };
  if (isNumber(raw.resetsAt)) error.resetsAt = raw.resetsAt;
  if (isString(raw.limitType)) error.limitType = raw.limitType;
  return error;
}

function parseCounts(raw: Json): TokenCounts | null {
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = raw;
  if (
    !isNumber(inputTokens) ||
    !isNumber(outputTokens) ||
    !isNumber(cacheReadTokens) ||
    !isNumber(cacheCreationTokens)
  ) {
    return null;
  }
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
}

function parseUsage(raw: unknown): ChatUsage | undefined {
  if (!isObject(raw)) return undefined;
  const counts = parseCounts(raw);
  if (!counts || !Array.isArray(raw.models)) return undefined;
  const models: ModelUsageEntry[] = [];
  for (const item of raw.models) {
    if (!isObject(item) || !isString(item.model)) return undefined;
    const entryCounts = parseCounts(item);
    if (!entryCounts) return undefined;
    const entry: ModelUsageEntry = { model: item.model, ...entryCounts };
    if (isNumber(item.costUsd)) entry.costUsd = item.costUsd;
    models.push(entry);
  }
  const usage: ChatUsage = { ...counts, models };
  if (isNumber(raw.costUsd)) usage.costUsd = raw.costUsd;
  return usage;
}

function parseWindows(raw: unknown): UsageWindow[] | null {
  if (!Array.isArray(raw)) return null;
  const windows: UsageWindow[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isString(item.key) || !isString(item.label)) return null;
    if (item.utilization !== null && !isNumber(item.utilization)) return null;
    if (item.resetsAt !== null && !isNumber(item.resetsAt)) return null;
    windows.push({
      key: item.key,
      label: item.label,
      utilization: item.utilization,
      resetsAt: item.resetsAt,
    });
  }
  return windows;
}

function parseExtraUsage(raw: unknown): ExtraUsage | null | undefined {
  if (raw === null) return null;
  if (!isObject(raw) || typeof raw.enabled !== 'boolean') return undefined;
  const nullableNumber = (v: unknown) => (isNumber(v) ? v : null);
  return {
    enabled: raw.enabled,
    usedCredits: nullableNumber(raw.usedCredits),
    monthlyLimit: nullableNumber(raw.monthlyLimit),
    utilization: nullableNumber(raw.utilization),
    currency: isString(raw.currency) ? raw.currency : null,
  };
}

const AUTH_STATES: readonly string[] = ['signed_in', 'signed_out', 'not_installed', 'unknown'];

function parseProviders(raw: unknown): ProviderInfo[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ProviderInfo[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isProviderId(item.id) || !isString(item.name) || !isString(item.note)) {
      return null;
    }
    if (!isString(item.auth) || !AUTH_STATES.includes(item.auth)) return null;
    if (!Array.isArray(item.authMethods) || !Array.isArray(item.models)) return null;
    const authMethods = item.authMethods.filter(
      (m): m is ProviderAuthMethod => m === 'subscription' || m === 'apiKey',
    );
    const models: ProviderModel[] = [];
    for (const m of item.models) {
      if (!isObject(m) || !isString(m.id) || !isString(m.label)) return null;
      models.push({ id: m.id, label: m.label });
    }
    const info: ProviderInfo = {
      id: item.id,
      name: item.name,
      authMethods,
      auth: item.auth as ProviderAuthState,
      models,
      note: item.note,
    };
    if (item.authVia === 'subscription' || item.authVia === 'apiKey') info.authVia = item.authVia;
    const runtimes = parseRuntimeStatuses(item.runtimes);
    if (runtimes) info.runtimes = runtimes;
    out.push(info);
  }
  return out;
}

/** Validate one line received by the app. Never throws. */
export function parseEvent(line: string): ParseResult<BridgeEvent> {
  const parsed = parseObject(line);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const bad = () => fail('invalid_message', 'Unrecognized event shape.');

  if (v.type === 'error') {
    const error = parseBridgeError(v.error);
    if (!error) return bad();
    const event: ErrorEvent = { type: 'error', error };
    if (isString(v.id)) event.id = v.id;
    return { ok: true, value: event };
  }

  if (!isString(v.id)) return bad();
  const id = v.id;

  switch (v.type) {
    case 'pong':
      if (!isNumber(v.sentAt) || !isNumber(v.protocolVersion) || !isString(v.bridgeVersion)) {
        return fail('invalid_message', 'Pong is missing version fields.');
      }
      return {
        ok: true,
        value: {
          type: 'pong',
          id,
          sentAt: v.sentAt,
          protocolVersion: v.protocolVersion,
          bridgeVersion: v.bridgeVersion,
        },
      };
    case 'chat.text':
      if (!isString(v.text)) return bad();
      return { ok: true, value: { type: 'chat.text', id, text: v.text } };
    case 'chat.tool_use':
      if (!isString(v.toolUseId) || !isString(v.name) || !isString(v.summary)) return bad();
      return {
        ok: true,
        value: {
          type: 'chat.tool_use',
          id,
          toolUseId: v.toolUseId,
          name: v.name,
          summary: v.summary,
        },
      };
    case 'chat.tool_result':
      if (!isString(v.toolUseId) || typeof v.isError !== 'boolean') return bad();
      return {
        ok: true,
        value: { type: 'chat.tool_result', id, toolUseId: v.toolUseId, isError: v.isError },
      };
    case 'chat.rate_limit': {
      if (v.status !== 'allowed_warning' && v.status !== 'rejected') return bad();
      const event: ChatRateLimitEvent = { type: 'chat.rate_limit', id, status: v.status };
      if (isString(v.limitType)) event.limitType = v.limitType;
      if (isNumber(v.resetsAt)) event.resetsAt = v.resetsAt;
      if (isNumber(v.utilization)) event.utilization = v.utilization;
      return { ok: true, value: event };
    }
    case 'chat.limits': {
      const windows = parseWindows(v.windows);
      return windows ? { ok: true, value: { type: 'chat.limits', id, windows } } : bad();
    }
    case 'usage.report': {
      const windows = parseWindows(v.windows);
      const extraUsage = parseExtraUsage(v.extraUsage);
      if (!windows || extraUsage === undefined || typeof v.available !== 'boolean') return bad();
      if (v.subscriptionType !== null && !isString(v.subscriptionType)) return bad();
      return {
        ok: true,
        value: {
          type: 'usage.report',
          id,
          available: v.available,
          subscriptionType: v.subscriptionType,
          windows,
          extraUsage,
        },
      };
    }
    case 'providers.report': {
      const providers = parseProviders(v.providers);
      return providers ? { ok: true, value: { type: 'providers.report', id, providers } } : bad();
    }
    case 'chat.done': {
      if (v.status !== 'completed' && v.status !== 'cancelled') return bad();
      const event: ChatDoneEvent = { type: 'chat.done', id, status: v.status };
      if (isString(v.model)) event.model = v.model;
      const usage = parseUsage(v.usage);
      if (usage) event.usage = usage;
      if (isNumber(v.durationMs)) event.durationMs = v.durationMs;
      return { ok: true, value: event };
    }
    default:
      return bad();
  }
}

/** Events that end a chat stream; after one of these nothing else arrives for that id. */
export function isTerminalEvent(event: BridgeEvent): boolean {
  return event.type === 'chat.done' || event.type === 'error';
}

export * from './status-feed';
