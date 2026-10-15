import { tmpdir } from 'node:os';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { ChatRequest } from '@geeked/protocol';
import { claudeExecutable } from './sdk';

export const DEFAULT_SYSTEM_PROMPT = [
  'You are Claude, chatting with a software developer in a desktop app called Geeked.',
  'Be direct and concise. Prefer working code over prose, use fenced code blocks with a language tag,',
  'and say so plainly when you are unsure.',
].join(' ');

const READONLY_TOOLS = ['Read', 'Glob', 'Grep'];

/**
 * Environment for the runtime. Geeked is meant to run on the user's Claude
 * subscription; a stray API key in the environment would silently make the
 * runtime bill the API instead, so those variables are removed (not read).
 */
export function runtimeEnv(base: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/**
 * Conservative defaults: plain chat has no tools; opt-in `readonly` exposes
 * only Read/Glob/Grep and `dontAsk` makes every other tool a denial instead of
 * a permission prompt nobody could answer. Nothing is persisted to
 * ~/.claude and no user/project settings (hooks, CLAUDE.md) are loaded.
 */
export function buildOptions(
  request: ChatRequest,
  controller: AbortController,
  onStderr: (data: string) => void,
  base: NodeJS.ProcessEnv = process.env,
): Options {
  const readonly = request.tools === 'readonly';
  const options: Options = {
    abortController: controller,
    includePartialMessages: true,
    persistSession: false,
    settingSources: [],
    systemPrompt: request.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
    tools: readonly ? READONLY_TOOLS : [],
    permissionMode: readonly ? 'dontAsk' : 'default',
    maxTurns: readonly ? 25 : 1,
    // Without tools there is nothing to read, and the runtime otherwise tells the
    // model its working directory (the app's own path). Use a neutral one.
    cwd: tmpdir(),
    env: runtimeEnv(base),
    stderr: onStderr,
  };
  const executable = claudeExecutable(base);
  if (executable) options.pathToClaudeCodeExecutable = executable;
  if (readonly) {
    options.allowedTools = READONLY_TOOLS;
    if (request.cwd) options.cwd = request.cwd;
  }
  if (request.model && request.model !== 'default') options.model = request.model;
  return options;
}
