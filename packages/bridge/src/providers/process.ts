import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
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

/** What `ensureGuiPath` reads from the system; injectable so tests never run a shell. */
export interface GuiPathDeps {
  /**
   * The PATH the user's login shell sets up, when it has already been read (see
   * `primeLoginShellPath`), else null. Never blocks.
   */
  loginShellPath: (env: NodeJS.ProcessEnv) => string | null;
  /** Lists a folder's entries (for nvm's versions); empty when it does not exist. */
  listDir: (path: string) => string[];
}

const PATH_MARK = '__COMMAND_CENTER_PATH__';
const LOGIN_SHELL_TIMEOUT_MS = 3000;

/**
 * The PATH printed between the two marker lines, or null. Anything the rc files print before or
 * after is ignored, and only absolute entries are kept (a `.` or `node_modules/.bin` would
 * resolve against the bridge's own folder).
 */
export function parseLoginShellOutput(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/);
  const start = lines.indexOf(PATH_MARK);
  const end = start >= 0 ? lines.indexOf(PATH_MARK, start + 1) : -1;
  if (start < 0 || end < 0) return null;
  const dirs = lines
    .slice(start + 1, end)
    .join(':')
    .split(':')
    .filter((d) => posix.isAbsolute(d));
  return dirs.length > 0 ? dirs.join(':') : null;
}

/**
 * Asks the user's login shell for its PATH without blocking the bridge. The shell runs as an
 * interactive login shell (so `~/.zprofile` and `~/.zshrc` run) in its own process group; after
 * the timeout the whole group is killed with SIGKILL (interactive shells ignore SIGTERM, and a
 * grandchild could hold the pipe open) and null is returned. `printenv` prints the exported
 * PATH colon-joined in every shell, fish included.
 */
export function readLoginShellPath(
  env: NodeJS.ProcessEnv,
  spawnFn: typeof nodeSpawn = nodeSpawn,
  timeoutMs = LOGIN_SHELL_TIMEOUT_MS,
): Promise<string | null> {
  const shell = env.SHELL && posix.isAbsolute(env.SHELL) ? env.SHELL : '/bin/zsh';
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: ReturnType<typeof nodeSpawn>;
    try {
      child = spawnFn(
        shell,
        ['-ilc', `echo ${PATH_MARK}; /usr/bin/printenv PATH; echo ${PATH_MARK}`],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'ignore'],
          env: { ...env, TERM: 'dumb' },
        },
      );
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      child.stdout?.destroy();
      finish(parseLoginShellOutput(out));
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      out += d;
      // Done as soon as both markers arrived, even if rc-file children keep the pipe open.
      const parsed = parseLoginShellOutput(out);
      if (parsed !== null) finish(parsed);
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(parseLoginShellOutput(out)));
    child.unref();
  });
}

let loginPath: { value: string | null } | undefined;
let loginPathPending: Promise<void> | undefined;

/**
 * Starts reading the login shell's PATH (once per bridge process) and resolves when it is known.
 * The bridge awaits it before handling a request that may look up a CLI, so pings stay instant.
 */
export function primeLoginShellPath(env: NodeJS.ProcessEnv): Promise<void> {
  loginPathPending ??= readLoginShellPath(env).then((value) => {
    loginPath = { value };
  });
  return loginPathPending;
}

export const defaultGuiPathDeps: GuiPathDeps = {
  loginShellPath: () => loginPath?.value ?? null,
  listDir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
};

/**
 * Folders where macOS developer tools usually live: the login shell's PATH first, then
 * Homebrew (Apple Silicon and Intel), user-local bins, npm's global prefix, and the
 * volta/fnm/nvm Node shims (newest nvm version first).
 */
export function macPathDirs(env: NodeJS.ProcessEnv, deps: GuiPathDeps): string[] {
  const home = env.HOME ?? '';
  const dirs = (deps.loginShellPath(env) ?? '').split(':').filter((d) => posix.isAbsolute(d));
  dirs.push('/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin');
  if (home) {
    dirs.push(
      posix.join(home, '.local/bin'),
      posix.join(home, '.npm-global/bin'),
      posix.join(home, '.volta/bin'),
      posix.join(home, 'Library/Application Support/fnm/aliases/default/bin'),
      posix.join(home, '.local/share/fnm/aliases/default/bin'),
    );
    const nvm = env.NVM_DIR ?? posix.join(home, '.nvm');
    const versions = deps
      .listDir(posix.join(nvm, 'versions/node'))
      .filter((v) => /^v\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => compareVersions(b, a));
    for (const v of versions) dirs.push(posix.join(nvm, 'versions/node', v, 'bin'));
  }
  return dirs;
}

function compareVersions(a: string, b: string): number {
  const pa = a.slice(1).split('.').map(Number);
  const pb = b.slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Per environment: false once extended without the login PATH, true once extended with it. */
const guiPathDone = new WeakMap<NodeJS.ProcessEnv, boolean>();

/**
 * An app opened from the Finder or the Dock gets only the system PATH, so `claude`, `codex`,
 * `grok`, `node` or `ollama` installed with Homebrew, npm or nvm are not found, and an npm shim
 * that starts with `#!/usr/bin/env node` cannot find Node even when called by absolute path.
 * This extends `env.PATH` in place, so the lookup and every child spawned with this environment
 * see the same folders. Existing entries keep their order and win. It runs again once the login
 * shell's PATH becomes known, and never after that.
 */
export function ensureGuiPath(
  env: NodeJS.ProcessEnv,
  deps: GuiPathDeps = defaultGuiPathDeps,
): void {
  const state = guiPathDone.get(env);
  if (state === true) return;
  const login = deps.loginShellPath(env);
  if (state === false && login === null) return;
  const current = (env.PATH ?? '').split(':').filter(Boolean);
  const merged = [...new Set([...current, ...macPathDirs(env, deps)])];
  env.PATH = merged.join(':');
  guiPathDone.set(env, login !== null);
}

/**
 * Finds an executable on PATH without ever using a shell for ordinary programs. Windows npm
 * shims (`codex.cmd`) cannot be spawned directly, so those run through `cmd.exe /d /c` and the
 * caller's arguments are validated (`argsAreShellSafe`); prompts must go over stdin there.
 * On macOS the PATH is first extended with the folders a GUI launch misses (`ensureGuiPath`).
 */
export function resolveCommand(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
  gui: GuiPathDeps = defaultGuiPathDeps,
): ResolvedCommand | null {
  if (platform === 'darwin') ensureGuiPath(env, gui);
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
