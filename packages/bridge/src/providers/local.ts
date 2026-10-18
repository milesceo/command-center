import {
  shellQuote,
  LOCAL_RUNTIMES,
  LOCAL_RUNTIME_INFO,
  runCommandLine,
  isHttpUrl,
  isLocalModelName,
  isLoopbackUrl,
  type ChatRequest,
  type LocalRunRequest,
  type LocalRuntimeId,
  type RuntimeStatus,
} from '@command-center/protocol';

// The command builder is shared with the Model Lab, which shows the same line before it runs.
export { LLAMA_PORT, MLX_PORT, nameFromFile, runCommandLine } from '@command-center/protocol';
import { openTerminalLine } from './claude';
import { paramsBody, streamCompatChat } from './openai-compat';
import { resolveCommand, type ResolvedCommand } from './process';
import type { ChatHandle, Provider, ProviderAuth, ProviderContext } from './types';

/**
 * Models served on this computer by the user's own runtime: Ollama, llama.cpp (`llama-server`),
 * MLX-LM (`mlx_lm.server`) or LM Studio, all through their OpenAI-compatible APIs (researched
 * 2026-10-17, see docs/providers.md). Command Center never downloads or runs model weights itself:
 * `run` opens a terminal with the runtime's own command, built here from validated parts, and
 * chats go to the server's `/chat/completions`. Only loopback servers are used unless the user
 * allows a remote one in Settings.
 */

const PROBE_TIMEOUT_MS = 1000;

function findRuntime(id: LocalRuntimeId, ctx: ProviderContext): ResolvedCommand | null {
  return resolveCommand(LOCAL_RUNTIME_INFO[id].command, ctx.env, ctx.platform, undefined, ctx.gui);
}

/** Lists the models a running server offers, or null when it does not answer in time. */
async function probe(baseUrl: string, ctx: ProviderContext): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Probes only ever go to the loopback presets, and never follow a redirect off this computer.
    const response = await ctx.fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: Array<{ id?: unknown }> | null };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter(isLocalModelName)
      .slice(0, 200);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Every runtime's install and server state (default ports). */
export async function runtimeStatuses(ctx: ProviderContext): Promise<RuntimeStatus[]> {
  return Promise.all(
    LOCAL_RUNTIMES.map(async (id): Promise<RuntimeStatus> => {
      const { baseUrl } = LOCAL_RUNTIME_INFO[id];
      const models = await probe(baseUrl, ctx);
      return {
        id,
        installed: findRuntime(id, ctx) !== null,
        running: models !== null,
        baseUrl,
        models: models ?? [],
      };
    }),
  );
}

/**
 * Wraps a command line so the terminal shows it and runs it only after the user presses Enter
 * (a download can be several GB). `/bin/sh` does this whatever the user's login shell is; the
 * line travels as an argument, so it is printed and run exactly as built.
 */
export function confirmFirst(line: string): string {
  const script =
    'printf "Command Center will run:\\n\\n  %s\\n\\nPress Enter to start, or close this window.\\n" "$1"; read _ && eval "$1"';
  return ['/bin/sh', '-c', script, 'sh', line].map(shellQuote).join(' ');
}

export const localProvider: Provider = {
  id: 'local',
  displayName: 'On this computer',
  authMethods: [],
  note: 'Runs models you serve yourself with Ollama, llama.cpp, MLX-LM or LM Studio. Nothing leaves this computer. Add models from the Model Lab.',

  models: () => [],

  async authStatus(ctx: ProviderContext): Promise<ProviderAuth> {
    const runtimes = await runtimeStatuses(ctx);
    const running = runtimes.some((r) => r.running);
    return {
      state: running
        ? 'signed_in'
        : runtimes.some((r) => r.installed)
          ? 'signed_out'
          : 'not_installed',
      detail: running ? 'A local model server is running' : 'No local model server is running',
      runtimes,
    };
  },

  chat(request: ChatRequest, ctx: ProviderContext): ChatHandle {
    const fail = (message: string) => {
      ctx.emit({ type: 'error', id: request.id, error: { code: 'invalid_request', message } });
      return { done: Promise.resolve(), cancel: () => undefined };
    };
    const baseUrl = request.baseUrl ?? LOCAL_RUNTIME_INFO.ollama.baseUrl;
    // The protocol parser checks this too; the adapter does not rely on it.
    if (!(request.allowRemote ? isHttpUrl(baseUrl) : isLoopbackUrl(baseUrl))) {
      return fail(
        'Local models must be served on this computer (or allow remote servers in Settings).',
      );
    }
    if (!isLocalModelName(request.model)) return fail('Choose a local model in the Model Lab.');
    return streamCompatChat(request, ctx, {
      service: 'the local model server',
      url: `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      // llama-server accepts any key unless started with --api-key; others ignore the header.
      headers: { authorization: 'Bearer no-key' },
      // On this computer only, a redirect could carry the chat elsewhere: refuse it.
      ...(request.allowRemote ? {} : { redirect: 'error' as const }),
      model: request.model,
      // The servers read top_k and their own repetition penalty name; unknown keys are ignored.
      extra: paramsBody(request.params, { topK: 'top_k', repetitionPenalty: 'repetition_penalty' }),
    });
  },

  async run(request: LocalRunRequest, ctx: ProviderContext): Promise<void> {
    const info = LOCAL_RUNTIME_INFO[request.runtime];
    const command = findRuntime(request.runtime, ctx);
    if (!command || command.viaShell) {
      throw new Error(`${info.label} is not installed (\`${info.command}\` was not found).`);
    }
    const line = runCommandLine(request, command.file);
    const instructions = () => new Error(`Run this in a terminal: ${line}`);
    if (ctx.platform !== 'darwin') throw instructions();
    await openTerminalLine(ctx, confirmFirst(line), instructions);
  },
};
