import { tmpdir } from 'node:os';
import type { ChatRequest, ProviderModel } from '@command-center/protocol';
import { DEFAULT_SYSTEM_PROMPT } from '../options';
import { buildPrompt } from '../prompt';
import { streamCompatChat } from './openai-compat';
import { openTerminal } from './claude';
import { resolveCommand, runProcess, type ResolvedCommand } from './process';
import type { ChatHandle, Provider, ProviderAuth, ProviderContext } from './types';

/**
 * Grok (xAI). Two official routes, tried in this order:
 *
 *  1. An API key (kept in the OS keychain by the app, passed per request): the documented
 *     xAI API at https://api.x.ai/v1, OpenAI-compatible chat completions with SSE streaming.
 *  2. The official Grok CLI (`grok login`, which supports SuperGrok / X Premium+ sign-in) run
 *     headless with `-p`. xAI documents the flags but not a stable event schema for the JSON
 *     output formats, so Command Center uses plain text output only. This route is beta.
 *
 * Command Center never touches the CLI's credentials and never reuses a web session.
 */

export const XAI_CHAT_URL = 'https://api.x.ai/v1/chat/completions';
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
/** Windows caps a command line near 32k characters; leave headroom for the other flags. */
export const MAX_CLI_PROMPT_CHARS = 24_000;
const CLI_TIMEOUT_MS = 10 * 60_000;

export function findGrok(ctx: ProviderContext): ResolvedCommand | null {
  return resolveCommand('grok', ctx.env, ctx.platform, undefined, ctx.gui);
}

// SSE parsing and the streaming loop live in `openai-compat.ts` (shared with Hugging Face and
// the local servers). Re-exported so existing imports keep working.
export { SseParser, type SseDelta } from './openai-compat';

// ------------------------------------------------------------------- chat

function chatViaApi(request: ChatRequest, ctx: ProviderContext): ChatHandle {
  const model = request.model && request.model !== 'default' ? request.model : 'grok-4.7';
  if (!MODEL_PATTERN.test(model)) {
    ctx.emit({
      type: 'error',
      id: request.id,
      error: { code: 'invalid_request', message: 'That model id is not valid.' },
    });
    return { done: Promise.resolve(), cancel: () => undefined };
  }
  return streamCompatChat(request, ctx, {
    service: 'xAI',
    credential: 'API key',
    url: XAI_CHAT_URL,
    headers: { authorization: `Bearer ${request.apiKey ?? ''}` },
    model,
  });
}

function chatViaCli(
  request: ChatRequest,
  ctx: ProviderContext,
  command: ResolvedCommand,
): ChatHandle {
  const controller = new AbortController();
  const { id } = request;
  const started = Date.now();

  const done = (async () => {
    const system = request.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
    const prompt = `${system}\n\n${buildPrompt(request.messages, MAX_CLI_PROMPT_CHARS)}`;
    if (command.viaShell) {
      ctx.emit({
        type: 'error',
        id,
        error: {
          code: 'invalid_request',
          message:
            'The Grok CLI was found as a script shim, which cannot take a prompt safely. Use an API key instead.',
        },
      });
      return;
    }
    if (prompt.length > MAX_CLI_PROMPT_CHARS + system.length + 64) {
      ctx.emit({
        type: 'error',
        id,
        error: {
          code: 'invalid_request',
          message:
            'This conversation is too long for the Grok CLI. Start a new chat or use an API key.',
        },
      });
      return;
    }
    const args = ['-p', prompt, '--output-format', 'plain', '--no-auto-update', '--cwd', tmpdir()];
    if (request.model && request.model !== 'default') {
      if (!MODEL_PATTERN.test(request.model)) {
        ctx.emit({
          type: 'error',
          id,
          error: { code: 'invalid_request', message: 'That model id is not valid.' },
        });
        return;
      }
      args.push('-m', request.model);
    }

    let produced = false;
    const result = await runProcess(ctx.spawn, command, args, {
      signal: controller.signal,
      env: ctx.env,
      cwd: tmpdir(),
      timeoutMs: CLI_TIMEOUT_MS,
      onChunk: (text) => {
        if (text.length === 0) return;
        produced = true;
        ctx.emit({ type: 'chat.text', id, text });
      },
    });

    if (result.aborted) {
      ctx.emit({ type: 'chat.done', id, status: 'cancelled' });
    } else if (result.startError) {
      ctx.emit({
        type: 'error',
        id,
        error: { code: 'sdk_unavailable', message: result.startError.message },
      });
    } else if (result.timedOut) {
      ctx.emit({
        type: 'error',
        id,
        error: { code: 'internal', message: 'The Grok CLI took too long and was stopped.' },
      });
    } else if (result.code !== 0 || !produced) {
      const message = result.stderr.trim() || `The Grok CLI exited with code ${result.code}.`;
      const auth = /log ?in|sign ?in|authenticat|unauthorized|\b401\b|not logged/i.test(message);
      ctx.emit({
        type: 'error',
        id,
        error: { code: auth ? 'auth_required' : 'internal', message },
      });
    } else {
      ctx.emit({
        type: 'chat.done',
        id,
        status: 'completed',
        model: request.model && request.model !== 'default' ? request.model : 'grok',
        durationMs: Date.now() - started,
      });
    }
  })();

  return { done, cancel: () => controller.abort() };
}

export const grokProvider: Provider = {
  id: 'xai',
  displayName: 'Grok',
  authMethods: ['apiKey', 'subscription'],
  note: "Use an xAI API key, or sign in through xAI's official Grok CLI (SuperGrok / X Premium+). The CLI route is beta: xAI documents no stable output schema, so replies are plain text with no token counts.",

  models(): ProviderModel[] {
    return [
      { id: 'default', label: 'Default' },
      { id: 'grok-4.7', label: 'Grok 4.7' },
    ];
  },

  async authStatus(ctx, hasKey): Promise<ProviderAuth> {
    if (hasKey) return { state: 'signed_in', via: 'apiKey' };
    const command = findGrok(ctx);
    if (!command) return { state: 'not_installed', detail: 'No API key and no Grok CLI found.' };
    // xAI documents `grok login` but no way to query its state, so this cannot be confirmed.
    return { state: 'unknown', detail: 'Grok CLI found; its login state cannot be checked.' };
  },

  chat(request, ctx): ChatHandle {
    if (request.apiKey) return chatViaApi(request, ctx);
    const command = findGrok(ctx);
    if (command) return chatViaCli(request, ctx, command);
    const done = Promise.resolve().then(() => {
      ctx.emit({
        type: 'error',
        id: request.id,
        error: {
          code: 'auth_required',
          message: 'Add an xAI API key in Settings, or install the Grok CLI and run `grok login`.',
        },
      });
    });
    return { done, cancel: () => undefined };
  },

  async login(ctx) {
    const command = findGrok(ctx);
    if (!command) throw new Error('The Grok CLI is not installed; use an API key instead.');
    await openTerminal(ctx, command, ['login']);
  },
};
