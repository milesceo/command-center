import type { BridgeError, ChatParams, ChatRequest } from '@command-center/protocol';
import { DEFAULT_SYSTEM_PROMPT } from '../options';
import { renderMessage } from '../prompt';
import type { ChatHandle, ProviderContext } from './types';

/**
 * Streaming chat over an OpenAI-compatible `/chat/completions` endpoint: xAI's API, Hugging Face
 * Inference Providers and the local servers (Ollama, llama.cpp, MLX-LM, LM Studio) all speak it.
 * Each adapter supplies the URL, headers and which parameters its server understands.
 */

export interface SseDelta {
  text?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  done?: boolean;
  error?: string;
}

/** Incremental parser for an OpenAI-style `text/event-stream` body. */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseDelta[] {
    this.buffer += chunk;
    const out: SseDelta[] = [];
    let index: number;
    while ((index = this.buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index).replace(/^\r?\n\r?\n/, '');
      const delta = this.parseBlock(block);
      if (delta) out.push(delta);
    }
    return out;
  }

  private parseBlock(block: string): SseDelta | null {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (data === '') return null;
    if (data === '[DONE]') return { done: true };
    try {
      const json = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string | null } }>;
        usage?: SseDelta['usage'];
        error?: { message?: string } | string;
      };
      if (json.error) {
        const message = typeof json.error === 'string' ? json.error : json.error.message;
        return { error: message ?? 'The provider reported an error.' };
      }
      const text = json.choices?.[0]?.delta?.content ?? undefined;
      const delta: SseDelta = {};
      if (text) delta.text = text;
      if (json.usage) delta.usage = json.usage;
      return Object.keys(delta).length > 0 ? delta : null;
    } catch {
      return null;
    }
  }
}

/** Maps an HTTP failure to a protocol error, naming the service in the message. */
export function errorFromStatus(
  service: string,
  status: number,
  body: string,
  credential = 'credentials',
): BridgeError {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return {
      code: 'auth_required',
      message: `${service} rejected the ${credential} (HTTP ${status}). ${detail}`.trim(),
    };
  }
  if (status === 404) return { code: 'model_not_found', message: `Model not found. ${detail}` };
  if (status === 429)
    return { code: 'rate_limited', message: `Rate limited by ${service}. ${detail}` };
  if (status === 402) return { code: 'account', message: `${service} billing problem. ${detail}` };
  if (status === 400 || status === 422) {
    return { code: 'invalid_request', message: `${service} rejected the request. ${detail}` };
  }
  if (status >= 500) {
    return { code: 'overloaded', message: `${service} is unavailable (HTTP ${status}).` };
  }
  return { code: 'internal', message: `${service} returned HTTP ${status}. ${detail}` };
}

/** Which of the optional parameters a server accepts, and under which JSON names. */
export interface ParamSupport {
  topK?: string;
  repetitionPenalty?: string;
  /** Extra JSON for the context length, e.g. Ollama's `options.num_ctx`. */
  contextLength?: (n: number) => Record<string, unknown>;
  /** Most stop sequences the server takes (HF: 4). */
  maxStop?: number;
}

/** The request body fields for `params`, in the OpenAI names plus the server's own extras. */
export function paramsBody(
  params: ChatParams | undefined,
  support: ParamSupport,
): Record<string, unknown> {
  if (!params) return {};
  const body: Record<string, unknown> = {};
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.stop?.length) body.stop = params.stop.slice(0, support.maxStop ?? params.stop.length);
  if (params.topK !== undefined && support.topK) body[support.topK] = params.topK;
  if (params.repetitionPenalty !== undefined && support.repetitionPenalty) {
    body[support.repetitionPenalty] = params.repetitionPenalty;
  }
  if (params.contextLength !== undefined && support.contextLength) {
    Object.assign(body, support.contextLength(params.contextLength));
  }
  return body;
}

export interface CompatChatOptions {
  /** Shown in error messages ("Hugging Face", "Ollama"). */
  service: string;
  /** What a 401/403 says was rejected ("API key" for xAI, as before; "token" for Hugging Face). */
  credential?: string;
  url: string;
  headers: Record<string, string>;
  model: string;
  /** Extra body fields (parameters). */
  extra?: Record<string, unknown>;
  /** Ask for a usage chunk at the end of the stream (`stream_options.include_usage`). */
  includeUsage?: boolean;
  /** `error` refuses redirects (local servers: a loopback port must not bounce a chat elsewhere). */
  redirect?: 'error' | 'follow';
}

/**
 * Streams one chat: emits `chat.text` deltas, then exactly one `chat.done` (completed with usage
 * when the server reports it, or cancelled) or `error`. Never throws.
 */
export function streamCompatChat(
  request: ChatRequest,
  ctx: ProviderContext,
  options: CompatChatOptions,
): ChatHandle {
  const controller = new AbortController();
  const { id } = request;
  const started = Date.now();
  const { service, model } = options;

  const done = (async () => {
    const messages = [
      { role: 'system', content: request.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT },
      ...request.messages.map((m) => ({ role: m.role, content: renderMessage(m) })),
    ];
    try {
      const response = await ctx.fetch(options.url, {
        method: 'POST',
        signal: controller.signal,
        ...(options.redirect ? { redirect: options.redirect } : {}),
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          ...(options.includeUsage === false ? {} : { stream_options: { include_usage: true } }),
          ...options.extra,
        }),
      });
      if (!response.ok) {
        ctx.emit({
          type: 'error',
          id,
          error: errorFromStatus(
            service,
            response.status,
            await response.text().catch(() => ''),
            options.credential,
          ),
        });
        return;
      }
      if (!response.body) {
        ctx.emit({
          type: 'error',
          id,
          error: { code: 'internal', message: `${service} returned an empty response.` },
        });
        return;
      }
      const parser = new SseParser();
      const decoder = new TextDecoder();
      let usage: SseDelta['usage'];
      let failed = false;
      const reader = response.body.getReader();
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        for (const delta of parser.push(decoder.decode(value, { stream: true }))) {
          if (delta.error) {
            ctx.emit({ type: 'error', id, error: { code: 'internal', message: delta.error } });
            failed = true;
            controller.abort();
            break;
          }
          if (delta.text) ctx.emit({ type: 'chat.text', id, text: delta.text });
          if (delta.usage) usage = delta.usage;
        }
        if (failed) break;
      }
      if (failed) return;
      const counts = {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      ctx.emit({
        type: 'chat.done',
        id,
        status: 'completed',
        model,
        ...(usage ? { usage: { ...counts, models: [{ model, ...counts }] } } : {}),
        durationMs: Date.now() - started,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        ctx.emit({ type: 'chat.done', id, status: 'cancelled' });
      } else {
        ctx.emit({
          type: 'error',
          id,
          error: {
            code: 'internal',
            message: `Could not reach ${service}: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      }
    }
  })();

  return { done, cancel: () => controller.abort() };
}
