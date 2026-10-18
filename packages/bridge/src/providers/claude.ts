import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import {
  MODEL_OPTIONS,
  shellQuote,
  type ChatRequest,
  type ProviderModel,
} from '@command-center/protocol';
import { runChat } from '../chat';
import { runUsage } from '../usage-report';
import { claudeExecutable } from '../sdk';
import { resolveCommand, runProcess, type ResolvedCommand } from './process';
import type { ChatHandle, Provider, ProviderAuth, ProviderContext } from './types';

/**
 * The first adapter: the existing Claude path (Agent SDK on the user's Claude Code login),
 * moved behind the `Provider` interface without changing what it does.
 */

const requireFromHere = createRequire(import.meta.url);

/** The native runtime the SDK ships for this platform, when it can be located. */
function sdkRuntime(platform: NodeJS.Platform): string | null {
  const arch = process.arch;
  const pkg = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  const file = platform === 'win32' ? 'claude.exe' : 'claude';
  try {
    const sdk = requireFromHere.resolve('@anthropic-ai/claude-agent-sdk');
    const fromSdk = createRequire(sdk);
    const path = fromSdk.resolve(`${pkg}/${file}`);
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

/** The Claude CLI to ask about login state: bundled runtime, then PATH, then the SDK's copy. */
export function findClaude(ctx: ProviderContext): ResolvedCommand | null {
  const bundled = claudeExecutable(ctx.env);
  if (bundled) return { file: bundled, prefix: [], viaShell: false };
  const onPath = resolveCommand('claude', ctx.env, ctx.platform, undefined, ctx.gui);
  if (onPath) return onPath;
  const fromSdk = sdkRuntime(ctx.platform);
  return fromSdk ? { file: fromSdk, prefix: [], viaShell: false } : null;
}

interface AuthStatusJson {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
}

export const claudeProvider: Provider = {
  id: 'claude',
  displayName: 'Claude',
  authMethods: ['subscription'],
  note: 'Uses your Claude Code login (your Claude subscription). No API key is ever used.',

  models(): ProviderModel[] {
    return MODEL_OPTIONS.map((m) => ({ id: m.id, label: m.label }));
  },

  async authStatus(ctx): Promise<ProviderAuth> {
    const command = findClaude(ctx);
    if (!command) return { state: 'not_installed', detail: 'Claude Code runtime not found.' };
    const lines: string[] = [];
    const result = await runProcess(ctx.spawn, command, ['auth', 'status'], {
      env: ctx.env,
      timeoutMs: 15_000,
      onLine: (l) => lines.push(l),
    });
    if (result.startError) return { state: 'not_installed', detail: result.startError.message };
    try {
      const json = JSON.parse(lines.join('\n')) as AuthStatusJson;
      if (json.loggedIn === true) {
        const via = json.authMethod === 'claude.ai' ? 'subscription' : undefined;
        return {
          state: 'signed_in',
          ...(via ? { via } : {}),
          detail: json.subscriptionType ? `Plan: ${json.subscriptionType}` : undefined,
        };
      }
      return { state: 'signed_out' };
    } catch {
      return { state: result.code === 0 ? 'unknown' : 'signed_out' };
    }
  },

  chat(request: ChatRequest, ctx: ProviderContext): ChatHandle {
    const controller = new AbortController();
    const done = (async () => {
      let query;
      try {
        query = await ctx.getQuery();
      } catch (err) {
        ctx.emit({
          type: 'error',
          id: request.id,
          error: {
            code: 'sdk_unavailable',
            message: err instanceof Error ? err.message : String(err),
          },
        });
        return;
      }
      await runChat({ query, emit: ctx.emit }, request, controller);
    })();
    return { done, cancel: () => controller.abort() };
  },

  async login(ctx) {
    const command = findClaude(ctx);
    if (!command) throw new Error('The Claude Code runtime was not found.');
    await openTerminal(ctx, command, ['auth', 'login']);
  },

  async usage(id, ctx) {
    try {
      const query = await ctx.getQuery();
      await runUsage({ query, emit: ctx.emit }, id);
    } catch (err) {
      ctx.emit({
        type: 'error',
        id,
        error: {
          code: 'sdk_unavailable',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },
};

export { shellQuote } from '@command-center/protocol';

/** An AppleScript string literal (backslashes and double quotes escaped). */
export const appleScriptString = (text: string): string =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * The `osascript -e` lines that open a new terminal window running `commandLine`: iTerm when the
 * bridge was started from it (`TERM_PROGRAM`), otherwise Terminal.app. Both run it in the user's
 * own login shell and keep the window open afterwards.
 */
export function macTerminalScript(commandLine: string, env: NodeJS.ProcessEnv): string[] {
  const text = appleScriptString(commandLine);
  if (env.TERM_PROGRAM === 'iTerm.app') {
    return [
      'tell application "iTerm"',
      'activate',
      'set w to (create window with default profile)',
      `tell current session of w to write text ${text}`,
      'end tell',
    ];
  }
  return ['tell application "Terminal"', 'activate', `do script ${text}`, 'end tell'];
}

/**
 * Opens the CLI's own sign-in in a terminal window so the user completes it there (the CLI may
 * ask them to paste a code). Windows opens a console window; macOS opens Terminal.app (or
 * iTerm) through `osascript`, with the command quoted for the shell and then for AppleScript,
 * and no shell of ours in between. Elsewhere the UI shows the command to run.
 */
export async function openTerminal(
  ctx: ProviderContext,
  command: ResolvedCommand,
  args: string[],
): Promise<void> {
  const instructions = () =>
    new Error(`Run \`${[command.file, ...args].join(' ')}\` in a terminal to sign in.`);
  if (ctx.platform === 'darwin') {
    const line = [command.file, ...args].map(shellQuote).join(' ');
    await openTerminalLine(ctx, line, instructions);
    return;
  }
  if (ctx.platform !== 'win32') throw instructions();
  const program = command.viaShell ? (command.prefix[2] ?? command.file) : command.file;
  // `start "" cmd /k <program> <args>` opens a new console window that stays open.
  const child = ctx.spawn(
    ctx.env.ComSpec ?? 'cmd.exe',
    ['/d', '/c', 'start', '""', 'cmd', '/k', program, ...args],
    { detached: true, stdio: 'ignore', env: ctx.env },
  );
  child.on('error', () => undefined);
}

/**
 * macOS: opens Terminal (or iTerm) running `line`, a shell command line the caller built with
 * `shellQuote` from validated parts, and waits for `osascript`: when macOS refuses (Automation
 * permission denied, Terminal missing) it throws `fail()`, so the UI shows the command to run
 * instead of silently doing nothing.
 */
export async function openTerminalLine(
  ctx: ProviderContext,
  line: string,
  fail: () => Error,
): Promise<void> {
  const script = macTerminalScript(line, ctx.env);
  const ok = await new Promise<boolean>((resolve) => {
    const child = ctx.spawn(
      '/usr/bin/osascript',
      script.flatMap((l) => ['-e', l]),
      {
        stdio: 'ignore',
        env: ctx.env,
      },
    );
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
  if (!ok) throw fail();
}
