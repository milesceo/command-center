import { describe, expect, it, vi } from 'vitest';
import { appleScriptString, macTerminalScript, openTerminal, shellQuote } from './claude';
import {
  ensureGuiPath,
  macPathDirs,
  parseLoginShellOutput,
  readLoginShellPath,
  resolveCommand,
  type ChildLike,
  type GuiPathDeps,
  type SpawnFn,
} from './process';
import type { ProviderContext } from './types';

const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function deps(
  login: string | null,
  nvmVersions: string[] = [],
): GuiPathDeps & {
  loginShellPath: ReturnType<typeof vi.fn>;
} {
  return {
    loginShellPath: vi.fn(() => login),
    listDir: (path) => (path.endsWith('/.nvm/versions/node') ? nvmVersions : []),
  };
}

describe('macPathDirs', () => {
  it('puts the login shell PATH first, then Homebrew, user bins and Node shims', () => {
    const dirs = macPathDirs({ HOME: '/Users/a' }, deps('/opt/custom/bin:/usr/bin'));
    expect(dirs.slice(0, 2)).toEqual(['/opt/custom/bin', '/usr/bin']);
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/usr/local/bin');
    expect(dirs).toContain('/Users/a/.local/bin');
    expect(dirs).toContain('/Users/a/.npm-global/bin');
    expect(dirs).toContain('/Users/a/.volta/bin');
    expect(dirs).toContain('/Users/a/Library/Application Support/fnm/aliases/default/bin');
  });

  it('adds nvm versions newest first and ignores anything that is not a version', () => {
    const dirs = macPathDirs(
      { HOME: '/Users/a' },
      deps(null, ['v18.20.1', 'v22.12.0', 'v9.0.0', 'system', '.DS_Store', 'v22.2.0']),
    );
    const nvm = dirs.filter((d) => d.includes('/.nvm/'));
    expect(nvm).toEqual([
      '/Users/a/.nvm/versions/node/v22.12.0/bin',
      '/Users/a/.nvm/versions/node/v22.2.0/bin',
      '/Users/a/.nvm/versions/node/v18.20.1/bin',
      '/Users/a/.nvm/versions/node/v9.0.0/bin',
    ]);
  });

  it('honors NVM_DIR', () => {
    const d: GuiPathDeps = {
      loginShellPath: () => null,
      listDir: (p) => (p === '/x/nvm/versions/node' ? ['v20.0.0'] : []),
    };
    expect(macPathDirs({ HOME: '/Users/a', NVM_DIR: '/x/nvm' }, d)).toContain(
      '/x/nvm/versions/node/v20.0.0/bin',
    );
  });

  it('works without HOME and without a readable login shell', () => {
    const dirs = macPathDirs({}, deps(null));
    expect(dirs).toEqual(['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin']);
  });
});

describe('ensureGuiPath', () => {
  it('extends PATH once, in place, keeping existing entries first and without duplicates', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/Users/a', PATH: SYSTEM_PATH };
    const d = deps('/opt/homebrew/bin:/usr/bin:/Users/a/.local/node/bin');
    ensureGuiPath(env, d);
    const parts = (env.PATH ?? '').split(':');
    expect(parts.slice(0, 4)).toEqual(SYSTEM_PATH.split(':'));
    expect(parts).toContain('/Users/a/.local/node/bin');
    expect(new Set(parts).size).toBe(parts.length);
    const after = env.PATH;
    const reads = d.loginShellPath.mock.calls.length;
    ensureGuiPath(env, d);
    expect(env.PATH).toBe(after);
    expect(d.loginShellPath).toHaveBeenCalledTimes(reads); // done for good: not even asked again
  });
});

describe('resolveCommand on macOS', () => {
  it('finds a CLI that only the login shell or Homebrew knows about', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/Users/a', PATH: SYSTEM_PATH };
    const found = resolveCommand(
      'codex',
      env,
      'darwin',
      (p) => p === '/opt/homebrew/bin/codex',
      deps(null),
    );
    expect(found).toEqual({ file: '/opt/homebrew/bin/codex', prefix: [], viaShell: false });
    // The child inherits the same PATH, so its `#!/usr/bin/env node` finds Node too.
    expect(env.PATH).toContain('/opt/homebrew/bin');
  });

  it('leaves Linux and Windows untouched', () => {
    const d = deps('/never');
    const linux: NodeJS.ProcessEnv = { PATH: SYSTEM_PATH };
    expect(resolveCommand('codex', linux, 'linux', () => false, d)).toBeNull();
    expect(linux.PATH).toBe(SYSTEM_PATH);
    expect(d.loginShellPath).not.toHaveBeenCalled();
  });
});

describe('quoting for the macOS terminal', () => {
  it('leaves simple words alone and single-quotes everything else', () => {
    expect(shellQuote('/opt/homebrew/bin/codex')).toBe('/opt/homebrew/bin/codex');
    expect(shellQuote('login')).toBe('login');
    expect(shellQuote('/Applications/Command Center.app/claude')).toBe(
      "'/Applications/Command Center.app/claude'",
    );
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('$(rm -rf ~)')).toBe("'$(rm -rf ~)'");
    expect(shellQuote('')).toBe("''");
    expect(shellQuote('café ☕')).toBe("'café ☕'");
  });

  it('escapes backslashes and double quotes for AppleScript', () => {
    expect(appleScriptString('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });

  it('uses Terminal.app by default and iTerm when started from iTerm', () => {
    expect(macTerminalScript('codex login', {})).toEqual([
      'tell application "Terminal"',
      'activate',
      'do script "codex login"',
      'end tell',
    ]);
    const iterm = macTerminalScript('codex login', { TERM_PROGRAM: 'iTerm.app' });
    expect(iterm[0]).toBe('tell application "iTerm"');
    expect(iterm).toContain('tell current session of w to write text "codex login"');
  });
});

describe('openTerminal on macOS', () => {
  function ctxWith(spawn: SpawnFn, env: NodeJS.ProcessEnv = {}): ProviderContext {
    return {
      emit: () => undefined,
      getQuery: () => Promise.reject(new Error('unused')),
      spawn,
      fetch: () => Promise.reject(new Error('unused')),
      env,
      platform: 'darwin',
    };
  }
  /** A child that exits with `code` right after the listeners are attached. */
  const fakeChild = (code = 0): ChildLike => {
    const child = {
      stdout: null,
      stderr: null,
      stdin: null,
      kill: () => true,
      on(event: string, listener: (arg: unknown) => void) {
        if (event === 'close') queueMicrotask(() => listener(code));
        return child;
      },
    };
    return child as never;
  };

  it('runs osascript directly (no shell) with the quoted command in a do script line', async () => {
    const spawn = vi.fn<SpawnFn>(() => fakeChild());
    await openTerminal(
      ctxWith(spawn),
      {
        file: '/Applications/Command Center.app/Contents/MacOS/claude',
        prefix: [],
        viaShell: false,
      },
      ['auth', 'login'],
    );
    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, options] = spawn.mock.calls[0]!;
    expect(file).toBe('/usr/bin/osascript');
    expect(args.filter((_, i) => i % 2 === 0).every((a) => a === '-e')).toBe(true);
    expect(args).toContain(
      `do script "'/Applications/Command Center.app/Contents/MacOS/claude' auth login"`,
    );
    expect(options).toMatchObject({ stdio: 'ignore' });
  });

  it('cannot be broken out of by a hostile path', async () => {
    const spawn = vi.fn<SpawnFn>(() => fakeChild());
    await openTerminal(
      ctxWith(spawn),
      { file: '/tmp/a"; do shell script "x', prefix: [], viaShell: false },
      ['login'],
    );
    const line = spawn.mock.calls[0]![1].find((a) => a.startsWith('do script '))!;
    // The whole command stays one AppleScript string literal: every inner quote is escaped.
    expect(line).toBe(`do script "'/tmp/a\\"; do shell script \\"x' login"`);
  });

  it('shows the command to run when macOS refuses (osascript fails)', async () => {
    const spawn = vi.fn<SpawnFn>(() => fakeChild(1));
    await expect(
      openTerminal(
        ctxWith(spawn),
        { file: '/opt/homebrew/bin/codex', prefix: [], viaShell: false },
        ['login'],
      ),
    ).rejects.toThrow('Run `/opt/homebrew/bin/codex login` in a terminal to sign in.');
  });

  it('still throws the instructions on Linux', async () => {
    const spawn = vi.fn<SpawnFn>(() => fakeChild());
    const ctx = { ...ctxWith(spawn), platform: 'linux' as const };
    await expect(
      openTerminal(ctx, { file: '/usr/bin/codex', prefix: [], viaShell: false }, ['login']),
    ).rejects.toThrow('Run `/usr/bin/codex login` in a terminal to sign in.');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('reading the login shell PATH', () => {
  const M = '__COMMAND_CENTER_PATH__';

  it('takes only what is between the markers, keeping absolute entries', () => {
    const out = `Last login: today\nwelcome!\n${M}\n/opt/homebrew/bin:.:node_modules/.bin:/Users/a/.cargo/bin\n${M}\nbye\n`;
    expect(parseLoginShellOutput(out)).toBe('/opt/homebrew/bin:/Users/a/.cargo/bin');
  });

  it('is null without both markers or with an empty PATH', () => {
    expect(parseLoginShellOutput('')).toBeNull();
    expect(parseLoginShellOutput(`${M}\n/usr/bin\n`)).toBeNull();
    expect(parseLoginShellOutput(`${M}\n\n${M}\n`)).toBeNull();
    expect(parseLoginShellOutput(`${M}\n./bin\n${M}\n`)).toBeNull();
  });

  it('handles CRLF output', () => {
    expect(parseLoginShellOutput(`${M}\r\n/usr/bin:/bin\r\n${M}\r\n`)).toBe('/usr/bin:/bin');
  });

  it('gives up after the timeout without waiting for the shell', async () => {
    // A shell that never prints anything and never exits.
    const hanging = vi.fn((_file: string, _args: string[], _options: object) => {
      const listeners: Record<string, () => void> = {};
      return {
        pid: undefined,
        stdout: { setEncoding: () => undefined, on: () => undefined, destroy: () => undefined },
        on: (event: string, fn: () => void) => {
          listeners[event] = fn;
        },
        unref: () => undefined,
      };
    });
    const started = Date.now();
    const value = await readLoginShellPath({ SHELL: '/bin/zsh' }, hanging as never, 50);
    expect(value).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(hanging.mock.calls[0]?.[1]).toEqual([
      '-ilc',
      `echo ${M}; /usr/bin/printenv PATH; echo ${M}`,
    ]);
  });

  it('reads a real POSIX shell when one is available', async () => {
    const value = await readLoginShellPath(
      { SHELL: '/bin/sh', PATH: '/usr/bin:/bin' },
      undefined,
      3000,
    );
    // /bin/sh -ilc may print a different PATH on each machine; it must be absolute entries.
    if (value !== null) expect(value.split(':').every((d) => d.startsWith('/'))).toBe(true);
  });
});

describe('ensureGuiPath once the login PATH arrives late', () => {
  it('adds the login PATH on a later call, then never again', () => {
    let login: string | null = null;
    const d: GuiPathDeps = { loginShellPath: () => login, listDir: () => [] };
    const env: NodeJS.ProcessEnv = { HOME: '/Users/a', PATH: '/usr/bin' };
    ensureGuiPath(env, d);
    expect(env.PATH).toContain('/opt/homebrew/bin');
    expect(env.PATH).not.toContain('/custom/bin');
    login = '/custom/bin';
    ensureGuiPath(env, d);
    expect(env.PATH).toContain('/custom/bin');
    login = '/later/bin';
    ensureGuiPath(env, d);
    expect(env.PATH).not.toContain('/later/bin');
  });
});
