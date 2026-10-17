import { tmpdir } from 'node:os';
import type { BridgeError, ChatRequest, ProviderModel } from '@command-center/protocol';
import { buildPrompt } from '../prompt';
import { DEFAULT_SYSTEM_PROMPT } from '../options';
import { openTerminal } from './claude';
import { argsAreShellSafe, resolveCommand, runProcess, type ResolvedCommand } from './process';
import type { ChatHandle, Provider, ProviderAuth, ProviderContext } from './types';

/**
 * ChatGPT / OpenAI, through OpenAI's official Codex CLI.
 *
 * OpenAI documents "Sign in with ChatGPT" (a subscription route) for Codex, and the Codex CLI
 * (`codex login`) is the supported way to use it. Command Center does not touch the login: the CLI
 * owns the credential cache, and Command Center only runs `codex exec` and reads its JSONL events.
 * There is deliberately no API-key path here; OpenAI's own docs point API-key users to its API.
 *
 * Limits: Codex is a coding agent and answers as one; replies arrive per message (not token by
 * token); tools stay off (`--sandbox read-only`, no approvals); usage is token counts only.
 */

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const TIMEOUT_MS = 10 * 60_000;

export function findCodex(ctx: ProviderContext): ResolvedCommand | null {
  return resolveCommand('codex', ctx.env, ctx.platform);
}

interface CodexItem {
  type?: string;
  item_type?: string;
  text?: string;
}
interface CodexEvent {
  type?: string;
  message?: string;
  item?: CodexItem;
  error?: { message?: string };
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
}

const AUTH = /not logged in|log ?in|sign ?in|authenticat|unauthorized|\b401\b|api key/i;
const LIMIT = /usage limit|rate limit|quota|too many requests|\b429\b/i;

function classify(message: string): BridgeError {
  if (AUTH.test(message)) {
    return { code: 'auth_required', message };
  }
  if (LIMIT.test(message)) return { code: 'rate_limited', message };
  return { code: 'internal', message };
}

/** Parses one `codex exec --json` line; unknown shapes are ignored, never fatal. */
export function parseCodexLine(line: string): CodexEvent | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as CodexEvent) : null;
  } catch {
    return null;
  }
}

export const codexProvider: Provider = {
  id: 'openai',
  displayName: 'ChatGPT',
  authMethods: ['subscription'],
  note: "Uses your ChatGPT plan through OpenAI's official Codex CLI. Install it (npm i -g @openai/codex) and sign in with Codex; Command Center never sees your credentials. Replies come as whole messages and tools are off.",

  models(): ProviderModel[] {
    return [{ id: 'default', label: 'Codex default' }];
  },

  async authStatus(ctx): Promise<ProviderAuth> {
    const command = findCodex(ctx);
    if (!command) return { state: 'not_installed', detail: 'The codex CLI was not found on PATH.' };
    const lines: string[] = [];
    const result = await runProcess(ctx.spawn, command, ['login', 'status'], {
      env: ctx.env,
      timeoutMs: 15_000,
      onLine: (l) => lines.push(l),
    });
    if (result.startError) return { state: 'not_installed', detail: result.startError.message };
    const text = `${lines.join(' ')} ${result.stderr}`.trim();
    if (result.code === 0) {
      return {
        state: 'signed_in',
        via: /chatgpt/i.test(text) ? 'subscription' : undefined,
        detail: lines[0],
      };
    }
    return { state: 'signed_out', detail: text.slice(0, 200) };
  },

  chat(request: ChatRequest, ctx: ProviderContext): ChatHandle {
    const controller = new AbortController();
    const { id } = request;
    const started = Date.now();

    const done = (async () => {
      const command = findCodex(ctx);
      if (!command) {
        ctx.emit({
          type: 'error',
          id,
          error: {
            code: 'sdk_unavailable',
            message: 'The Codex CLI is not installed. Run: npm i -g @openai/codex',
          },
        });
        return;
      }
      const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only'];
      if (request.model && request.model !== 'default') {
        if (!MODEL_PATTERN.test(request.model)) {
          ctx.emit({
            type: 'error',
            id,
            error: { code: 'invalid_request', message: 'That model id is not valid.' },
          });
          return;
        }
        args.push('--model', request.model);
      }
      args.push('-'); // the prompt is read from stdin
      if (command.viaShell && !argsAreShellSafe(args)) {
        ctx.emit({
          type: 'error',
          id,
          error: { code: 'invalid_request', message: 'Unsafe arguments for the Codex shim.' },
        });
        return;
      }

      const system = request.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
      const prompt = `${system}\n\n${buildPrompt(request.messages)}`;

      let failure: BridgeError | null = null;
      let usage: CodexEvent['usage'];
      const handle = (line: string) => {
        const event = parseCodexLine(line);
        if (!event) return;
        if (event.type === 'item.completed' && event.item) {
          const kind = event.item.type ?? event.item.item_type;
          if ((kind === 'agent_message' || kind === 'assistant_message') && event.item.text) {
            ctx.emit({ type: 'chat.text', id, text: event.item.text });
          }
        } else if (event.type === 'turn.completed') {
          usage = event.usage;
        } else if (event.type === 'turn.failed') {
          failure = classify(event.error?.message ?? 'The Codex run failed.');
        } else if (event.type === 'error' && event.message && !failure) {
          failure = classify(event.message);
        }
      };

      const result = await runProcess(ctx.spawn, command, args, {
        input: prompt,
        signal: controller.signal,
        env: ctx.env,
        cwd: tmpdir(),
        timeoutMs: TIMEOUT_MS,
        onLine: handle,
      });

      if (result.aborted) {
        ctx.emit({ type: 'chat.done', id, status: 'cancelled' });
      } else if (result.startError) {
        ctx.emit({
          type: 'error',
          id,
          error: { code: 'sdk_unavailable', message: result.startError.message },
        });
      } else if (failure) {
        ctx.emit({ type: 'error', id, error: failure });
      } else if (result.timedOut) {
        ctx.emit({
          type: 'error',
          id,
          error: { code: 'internal', message: 'The Codex run took too long and was stopped.' },
        });
      } else if (result.code !== 0) {
        ctx.emit({
          type: 'error',
          id,
          error: classify(result.stderr.trim() || `Codex exited with code ${result.code}.`),
        });
      } else {
        const input = usage?.input_tokens ?? 0;
        const cached = usage?.cached_input_tokens ?? 0;
        const output = usage?.output_tokens ?? 0;
        const model = request.model && request.model !== 'default' ? request.model : 'codex';
        const counts = {
          inputTokens: Math.max(0, input - cached),
          outputTokens: output,
          cacheReadTokens: cached,
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
      }
    })();

    return { done, cancel: () => controller.abort() };
  },

  async login(ctx) {
    const command = findCodex(ctx);
    if (!command) throw new Error('The Codex CLI is not installed. Run: npm i -g @openai/codex');
    openTerminal(ctx, command, ['login']);
  },
};
