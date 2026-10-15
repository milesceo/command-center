import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { Readable, Writable } from 'node:stream';

/** The slice of a child process the adapters use; tests pass a scripted fake. */
export interface ChildLike {
  stdout: Readable | null;
  stderr: Readable | null;
  stdin: Writable | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;
}

export type SpawnFn = (file: string, args: string[], options?: SpawnOptions) => ChildLike;

export const defaultSpawn: SpawnFn = (file, args, options) =>
  nodeSpawn(file, args, { windowsHide: true, ...options }) as unknown as ChildLike;

/** Characters that are safe to hand to `cmd.exe /c` for a `.cmd` shim without quoting rules. */
const SAFE_CMD_ARG = /^[A-Za-z0-9_.:@/\\=,+-]+$/;

export interface ResolvedCommand {
  file: string;
  /** Arguments to put before the caller's own (for `.cmd` shims run through cmd.exe). */
  prefix: string[];
  /** True when the caller's arguments must be restricted to simple characters. */
  viaShell: boolean;
}

/**
 * Finds an executable on PATH without ever using a shell for ordinary programs. Windows npm
 * shims (`codex.cmd`) cannot be spawned directly, so those run through `cmd.exe /d /c` and the
 * caller's arguments are validated (`argsAreShellSafe`); prompts must go over stdin there.
 */
export function resolveCommand(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): ResolvedCommand | null {
  const windows = platform === 'win32';
  const join = windows ? win32.join : posix.join;
  const dirs = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean);
  if (!windows) {
    for (const dir of dirs) {
      const file = join(dir, name);
      if (exists(file)) return { file, prefix: [], viaShell: false };
    }
    return null;
  }
  const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = join(dir, `${name}${ext.toLowerCase()}`);
      if (!exists(file)) continue;
      const lower = ext.toLowerCase();
      if (lower === '.cmd' || lower === '.bat') {
        return { file: env.ComSpec ?? 'cmd.exe', prefix: ['/d', '/c', file], viaShell: true };
      }
      return { file, prefix: [], viaShell: false };
    }
  }
  return null;
}

export const argsAreShellSafe = (args: readonly string[]): boolean =>
  args.every((a) => SAFE_CMD_ARG.test(a));

export interface RunOptions {
  input?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Called for every complete stdout line. */
  onLine?: (line: string) => void;
  /** Called for raw stdout chunks (for plain-text streaming). */
  onChunk?: (text: string) => void;
  timeoutMs?: number;
}

export interface RunResult {
  code: number | null;
  stderr: string;
  /** The process could not be started (not installed, no permission). */
  startError?: Error;
  aborted: boolean;
  timedOut: boolean;
}

const STDERR_TAIL = 2000;

/** Runs a child to completion, streaming stdout, honoring `signal` and `timeoutMs`. Never rejects. */
export function runProcess(
  spawn: SpawnFn,
  command: ResolvedCommand,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let buffer = '';
    let settled = false;
    let aborted = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildLike;

    const finish = (result: Omit<RunResult, 'stderr' | 'aborted' | 'timedOut'>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (buffer.length > 0) options.onLine?.(buffer);
      resolve({ ...result, stderr, aborted, timedOut });
    };

    const onAbort = () => {
      aborted = true;
      child?.kill('SIGTERM');
    };

    try {
      child = spawn(command.file, [...command.prefix, ...args], {
        env: options.env,
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish({ code: null, startError: err instanceof Error ? err : new Error(String(err)) });
      return;
    }

    child.on('error', (err) => finish({ code: null, startError: err }));
    child.on('close', (code) => finish({ code }));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d: string) => {
      stderr = (stderr + d).slice(-STDERR_TAIL);
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      options.onChunk?.(d);
      buffer += d;
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.length > 0) options.onLine?.(line);
      }
    });

    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    child.stdin?.on('error', () => undefined); // a closed pipe must not crash the bridge
    if (options.input !== undefined) child.stdin?.end(options.input);
    else child.stdin?.end();
  });
}
