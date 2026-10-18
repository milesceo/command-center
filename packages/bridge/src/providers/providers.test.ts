import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { BridgeEvent, ChatRequest } from '@command-center/protocol';
import { Bridge } from '../handler';
import { codexProvider, parseCodexLine } from './codex';
import { grokProvider, MAX_CLI_PROMPT_CHARS, SseParser, XAI_CHAT_URL } from './grok';
import {
  argsAreShellSafe,
  resolveCommand,
  type ChildLike,
  type GuiPathDeps,
  type SpawnFn,
} from './process';

/** No login shell and no folders: tests must not depend on what this machine has installed. */
const NO_GUI_PATH: GuiPathDeps = { loginShellPath: () => null, listDir: () => [] };
import { createRegistry, describeProviders } from './registry';
import type { ProviderContext } from './types';

// ------------------------------------------------------------- test doubles

interface Script {
  stdout?: string[];
  stderr?: string;
  code?: number;
  /** Never exits on its own; only `kill` ends it. */
  hang?: boolean;
  startError?: Error;
}

interface Call {
  file: string;
  args: string[];
  stdin: string;
}

function fakeSpawn(
  scripts: Record<string, Script>,
  calls: Call[] = [],
): { spawn: SpawnFn; calls: Call[] } {
  const spawn: SpawnFn = (file, args) => {
    const key = file
      .replace(/\\/g, '/')
      .split('/')
      .pop()!
      .replace(/\.(exe|cmd)$/i, '');
    const script = scripts[key] ?? { code: 127, stderr: 'not scripted' };
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const call: Call = { file, args, stdin: '' };
    calls.push(call);
    stdin.on('data', (d: Buffer) => (call.stdin += d.toString('utf8')));
    let closed = false;
    const close = (code: number | null) => {
      if (closed) return;
      closed = true;
      stdout.end();
      stderr.end();
      setImmediate(() => emitter.emit('close', code));
    };
    const child = emitter as unknown as ChildLike & EventEmitter;
    Object.assign(child, {
      stdout,
      stderr,
      stdin,
      kill: () => {
        close(null);
        return true;
      },
    });
    setImmediate(() => {
      if (script.startError) {
        emitter.emit('error', script.startError);
        return;
      }
      if (script.stderr) stderr.write(script.stderr);
      for (const line of script.stdout ?? []) stdout.write(`${line}\n`);
      if (!script.hang) close(script.code ?? 0);
    });
    return child;
  };
  return { spawn, calls };
}

function context(overrides: Partial<ProviderContext> & { events?: BridgeEvent[] } = {}) {
  const events: BridgeEvent[] = overrides.events ?? [];
  const ctx: ProviderContext = {
    emit: (e) => events.push(e),
    getQuery: () => Promise.reject(new Error('no sdk in this test')),
    spawn: fakeSpawn({}).spawn,
    fetch: () => Promise.reject(new Error('no network in this test')),
    env: { PATH: '/bin' },
    platform: process.platform,
    gui: NO_GUI_PATH,
    ...overrides,
  };
  return { ctx, events };
}

const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  type: 'chat',
  id: 'r1',
  messages: [{ role: 'user', content: 'Say hi' }],
  tools: 'off',
  ...over,
});

const exists = (set: string[]) => (p: string) => set.includes(p.replace(/\\/g, '/'));

// ---------------------------------------------------------------- resolveCommand

describe('resolveCommand', () => {
  it('finds a plain executable on PATH and returns null when absent', () => {
    const env = { PATH: '/a:/b' };
    expect(resolveCommand('codex', env, 'linux', exists(['/b/codex']))).toEqual({
      file: '/b/codex',
      prefix: [],
      viaShell: false,
    });
    expect(resolveCommand('codex', env, 'linux', exists([]))).toBeNull();
  });

  it('runs .cmd shims through cmd.exe on Windows and exes directly', () => {
    const env = { PATH: 'C:\npm', PATHEXT: '.EXE;.CMD', ComSpec: 'cmd.exe' };
    const shim = resolveCommand('codex', env, 'win32', (p) =>
      p.toLowerCase().endsWith('codex.cmd'),
    );
    expect(shim?.viaShell).toBe(true);
    expect(shim?.file).toBe('cmd.exe');
    expect(shim?.prefix.slice(0, 2)).toEqual(['/d', '/c']);
    const direct = resolveCommand('grok', env, 'win32', (p) =>
      p.toLowerCase().endsWith('grok.exe'),
    );
    expect(direct?.viaShell).toBe(false);
    expect(direct?.file.toLowerCase()).toContain('grok.exe');
  });

  it('validates arguments passed through a shell shim', () => {
    expect(argsAreShellSafe(['exec', '--json', '--model', 'gpt-5.2-codex'])).toBe(true);
    expect(argsAreShellSafe(['exec', '& calc'])).toBe(false);
    expect(argsAreShellSafe(['a"b'])).toBe(false);
  });
});

// ---------------------------------------------------------------- Codex (ChatGPT)

describe('codex adapter', () => {
  it('parses JSONL lines defensively', () => {
    expect(parseCodexLine('{"type":"turn.completed"}')).toEqual({ type: 'turn.completed' });
    expect(parseCodexLine('not json')).toBeNull();
    expect(parseCodexLine('[1,2]')).toEqual([1, 2]);
  });

  it('reports not_installed when the CLI is missing', async () => {
    const { ctx } = context({ env: { PATH: '/definitely/not/here' } });
    const auth = await codexProvider.authStatus(ctx, false);
    expect(auth.state).toBe('not_installed');
  });

  it('refuses a chat with a clear error when the CLI is missing', async () => {
    const { ctx, events } = context({ env: { PATH: '/definitely/not/here' } });
    await codexProvider.chat(request({ provider: 'openai' }), ctx).done;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      id: 'r1',
      error: { code: 'sdk_unavailable' },
    });
  });

  it('rejects a malformed model id before spawning anything', async () => {
    const dir = await makeFakeCli('codex');
    const { spawn, calls } = fakeSpawn({ codex: { code: 0 } });
    const { ctx, events } = context({ env: { PATH: dir }, spawn });
    await codexProvider.chat(request({ model: 'x; rm -rf /' }), ctx).done;
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'invalid_request' } });
    expect(calls).toHaveLength(0);
  });

  it('streams an agent message and reports token usage, sending the prompt over stdin', async () => {
    const dir = await makeFakeCli('codex');
    const { spawn, calls } = fakeSpawn({
      codex: {
        stdout: [
          '{"type":"thread.started","thread_id":"t1"}',
          '{"type":"item.completed","item":{"id":"i1","type":"reasoning","text":"thinking"}}',
          '{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Hi there"}}',
          '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":100,"output_tokens":7}}',
        ],
      },
    });
    const { ctx, events } = context({ env: { PATH: dir }, spawn });
    await codexProvider.chat(request({ model: 'gpt-5.2-codex' }), ctx).done;

    expect(events.map((e) => e.type)).toEqual(['chat.text', 'chat.done']);
    expect(events[0]).toMatchObject({ text: 'Hi there' });
    expect(events[1]).toMatchObject({
      status: 'completed',
      model: 'gpt-5.2-codex',
      usage: { inputTokens: 20, cacheReadTokens: 100, outputTokens: 7 },
    });
    const call = calls[0]!;
    expect(call.args).toEqual(
      expect.arrayContaining([
        'exec',
        '--json',
        '--sandbox',
        'read-only',
        '--model',
        'gpt-5.2-codex',
        '-',
      ]),
    );
    expect(call.stdin).toContain('Say hi');
    // The prompt travels over stdin, not the command line.
    expect(call.args.join(' ')).not.toContain('Say hi');
  });

  it('maps a failed turn to an auth error and a cancel to a cancelled done', async () => {
    const dir = await makeFakeCli('codex');
    const failing = fakeSpawn({
      codex: {
        stdout: ['{"type":"turn.failed","error":{"message":"Not logged in. Run codex login."}}'],
        code: 1,
      },
    });
    const a = context({ env: { PATH: dir }, spawn: failing.spawn });
    await codexProvider.chat(request(), a.ctx).done;
    expect(a.events[0]).toMatchObject({ type: 'error', error: { code: 'auth_required' } });

    const hanging = fakeSpawn({ codex: { hang: true } });
    const b = context({ env: { PATH: dir }, spawn: hanging.spawn });
    const handle = codexProvider.chat(request(), b.ctx);
    setTimeout(() => handle.cancel(), 20);
    await handle.done;
    expect(b.events).toEqual([{ type: 'chat.done', id: 'r1', status: 'cancelled' }]);
  });

  it('reads sign-in state from `codex login status`', async () => {
    const dir = await makeFakeCli('codex');
    const signedIn = fakeSpawn({ codex: { stdout: ['Logged in using ChatGPT'], code: 0 } });
    const a = context({ env: { PATH: dir }, spawn: signedIn.spawn });
    expect(await codexProvider.authStatus(a.ctx, false)).toMatchObject({
      state: 'signed_in',
      via: 'subscription',
    });
    const signedOut = fakeSpawn({ codex: { stderr: 'Not logged in', code: 1 } });
    const b = context({ env: { PATH: dir }, spawn: signedOut.spawn });
    expect((await codexProvider.authStatus(b.ctx, false)).state).toBe('signed_out');
  });
});

// ---------------------------------------------------------------- Grok (xAI)

function sseResponse(chunks: string[], init: ResponseInit = { status: 200 }): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, init);
}

describe('SseParser', () => {
  it('assembles events split across arbitrary chunk boundaries', () => {
    const parser = new SseParser();
    const body =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n';
    const out = [];
    for (let i = 0; i < body.length; i += 7) out.push(...parser.push(body.slice(i, i + 7)));
    expect(out.filter((d) => d.text).map((d) => d.text)).toEqual(['Hel', 'lo']);
    expect(out.find((d) => d.usage)?.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2 });
    expect(out.at(-1)).toEqual({ done: true });
  });

  it('surfaces in-stream errors and ignores comments and junk', () => {
    const parser = new SseParser();
    const out = parser.push(
      ': keep-alive\n\ndata: not-json\n\ndata: {"error":{"message":"boom"}}\n\n',
    );
    expect(out).toEqual([{ error: 'boom' }]);
  });
});

describe('grok adapter (API key route)', () => {
  it('streams deltas with the bearer key and reports usage', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const events: BridgeEvent[] = [];
    const { ctx } = context({
      events,
      fetch: async (url, init) => {
        seen = { url: String(url), init: init ?? {} };
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"Hey"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n',
          'data: [DONE]\n\n',
        ]);
      },
    });
    await grokProvider.chat(request({ provider: 'xai', apiKey: 'xai-secret-key' }), ctx).done;

    expect(seen!.url).toBe(XAI_CHAT_URL);
    expect((seen!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer xai-secret-key',
    );
    const body = JSON.parse(String(seen!.init.body));
    expect(body).toMatchObject({ model: 'grok-4.7', stream: true });
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Say hi' });

    expect(
      events.filter((e) => e.type === 'chat.text').map((e) => (e as { text: string }).text),
    ).toEqual(['Hey', '!']);
    expect(events.at(-1)).toMatchObject({
      type: 'chat.done',
      status: 'completed',
      usage: { inputTokens: 9, outputTokens: 2 },
    });
    // The key is never echoed back in any event.
    expect(JSON.stringify(events)).not.toContain('xai-secret-key');
  });

  it('maps HTTP failures to protocol errors', async () => {
    const cases: Array<[number, string]> = [
      [401, 'auth_required'],
      [429, 'rate_limited'],
      [404, 'model_not_found'],
      [503, 'overloaded'],
    ];
    for (const [status, code] of cases) {
      const { ctx, events } = context({
        fetch: async () => new Response('{"error":"nope"}', { status }),
      });
      await grokProvider.chat(request({ apiKey: 'k' }), ctx).done;
      expect(events[0], String(status)).toMatchObject({ type: 'error', error: { code } });
    }
  });

  it('keeps the original xAI wording in error details', async () => {
    const messages: string[] = [];
    for (const status of [401, 429, 402, 400, 503, 418]) {
      const { ctx, events } = context({
        fetch: async () => new Response('nope', { status }),
      });
      await grokProvider.chat(request({ apiKey: 'k' }), ctx).done;
      const event = events[0];
      messages.push(event?.type === 'error' ? event.error.message : '');
    }
    expect(messages).toEqual([
      'xAI rejected the API key (HTTP 401). nope',
      'Rate limited by xAI. nope',
      'xAI billing problem. nope',
      'xAI rejected the request. nope',
      'xAI is unavailable (HTTP 503).',
      'xAI returned HTTP 418. nope',
    ]);
  });

  it('turns an abort into a cancelled done', async () => {
    const { ctx, events } = context({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    const handle = grokProvider.chat(request({ apiKey: 'k' }), ctx);
    setTimeout(() => handle.cancel(), 10);
    await handle.done;
    expect(events).toEqual([{ type: 'chat.done', id: 'r1', status: 'cancelled' }]);
  });

  it('reports a key as signed in without touching the network', async () => {
    const { ctx } = context();
    expect(await grokProvider.authStatus(ctx, true)).toEqual({ state: 'signed_in', via: 'apiKey' });
  });
});

describe('grok adapter (official CLI route)', () => {
  it('runs `grok -p` headless and streams stdout as text', async () => {
    const dir = await makeFakeCli('grok');
    const { spawn, calls } = fakeSpawn({ grok: { stdout: ['Hello from Grok'], code: 0 } });
    const { ctx, events } = context({ env: { PATH: dir }, spawn });
    await grokProvider.chat(request({ provider: 'xai', model: 'grok-4.7' }), ctx).done;

    const call = calls[0]!;
    expect(call.args[0]).toBe('-p');
    expect(call.args).toEqual(
      expect.arrayContaining(['--output-format', 'plain', '-m', 'grok-4.7']),
    );
    expect(call.args[1]).toContain('Say hi');
    expect(events.at(0)).toMatchObject({
      type: 'chat.text',
      text: expect.stringContaining('Hello'),
    });
    expect(events.at(-1)).toMatchObject({ type: 'chat.done', status: 'completed' });
  });

  it('asks for a key or the CLI when neither exists', async () => {
    const { ctx, events } = context({ env: { PATH: '/nowhere' } });
    await grokProvider.chat(request(), ctx).done;
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'auth_required' } });
  });

  it('refuses a transcript too long for a command line', async () => {
    const dir = await makeFakeCli('grok');
    const { spawn, calls } = fakeSpawn({ grok: { stdout: ['x'] } });
    const { ctx, events } = context({ env: { PATH: dir }, spawn });
    const huge = 'y'.repeat(MAX_CLI_PROMPT_CHARS * 2);
    await grokProvider.chat(request({ messages: [{ role: 'user', content: huge }] }), ctx).done;
    // buildPrompt trims history but never the latest message, so the single huge turn is refused.
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'invalid_request' } });
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- registry and bridge

describe('registry', () => {
  it('registers Claude, ChatGPT, Grok, Hugging Face and local models with their official routes', async () => {
    const registry = createRegistry();
    expect([...registry.keys()].sort()).toEqual([
      'claude',
      'huggingface',
      'local',
      'openai',
      'xai',
    ]);
    expect(registry.get('huggingface')!.authMethods).toEqual(['apiKey']);
    expect(registry.get('local')!.authMethods).toEqual([]);
    expect(registry.get('claude')!.authMethods).toEqual(['subscription']);
    expect(registry.get('openai')!.authMethods).toEqual(['subscription']);
    expect(registry.get('xai')!.authMethods).toEqual(['apiKey', 'subscription']);

    // Linux: no macOS PATH extension, so nothing installed on the test machine is found.
    const { ctx } = context({ env: { PATH: '/nowhere' }, platform: 'linux' });
    const infos = await describeProviders(registry, ctx, ['xai']);
    const xai = infos.find((p) => p.id === 'xai')!;
    expect(xai.auth).toBe('signed_in');
    expect(xai.authVia).toBe('apiKey');
    expect(infos.find((p) => p.id === 'openai')!.auth).toBe('not_installed');
    // The original three ship models; Hugging Face and local models are the user's own.
    for (const info of infos.filter((p) => ['claude', 'openai', 'xai'].includes(p.id))) {
      expect(info.models.length).toBeGreaterThan(0);
    }
    expect(infos.find((p) => p.id === 'huggingface')).toMatchObject({
      auth: 'signed_out',
      models: [],
    });
    const local = infos.find((p) => p.id === 'local')!;
    expect(local.runtimes?.map((r) => r.id)).toEqual(['ollama', 'llama.cpp', 'mlx', 'lmstudio']);
    expect(local.runtimes?.every((r) => !r.running && !r.installed)).toBe(true);
    expect(local.auth).toBe('not_installed');
  });
});

describe('Bridge provider routing', () => {
  function bridgeWith(deps: Partial<ConstructorParameters<typeof Bridge>[0]> = {}) {
    const events: BridgeEvent[] = [];
    const bridge = new Bridge({
      getQuery: () => Promise.reject(new Error('no sdk')),
      emit: (e) => events.push(e),
      env: { PATH: '/nowhere' },
      platform: process.platform,
      gui: NO_GUI_PATH,
      spawn: fakeSpawn({}).spawn,
      ...deps,
    });
    return { bridge, events };
  }

  async function until(check: () => boolean, ms = 5000) {
    const deadline = Date.now() + ms;
    while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  }

  it('answers `providers` with a report that never contains a key', async () => {
    const { bridge, events } = bridgeWith();
    bridge.handleLine('{"type":"providers","id":"p1","hasKey":["xai"]}');
    await until(() => events.some((e) => e.type === 'providers.report'));
    const report = events.find((e) => e.type === 'providers.report');
    expect(report).toMatchObject({ id: 'p1' });
    expect(JSON.stringify(report)).not.toMatch(/api.?key":"/i);
  });

  it('routes a chat to the requested provider', async () => {
    const { bridge, events } = bridgeWith({
      fetch: async () =>
        sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']),
    });
    bridge.handleLine(
      JSON.stringify({
        type: 'chat',
        id: 'x1',
        messages: [{ role: 'user', content: 'hi' }],
        tools: 'off',
        provider: 'xai',
        apiKey: 'k',
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    await bridge.idle();
    expect(events.map((e) => e.type)).toEqual(['chat.text', 'chat.done']);
  });

  it('refuses a duplicate id and lets cancel stop a hanging provider chat', async () => {
    const dir = await makeFakeCli('codex');
    const { spawn } = fakeSpawn({ codex: { hang: true } });
    const { bridge, events } = bridgeWith({ env: { PATH: dir }, spawn });
    const line = JSON.stringify({
      type: 'chat',
      id: 'dup',
      messages: [{ role: 'user', content: 'hi' }],
      tools: 'off',
      provider: 'openai',
    });
    bridge.handleLine(line);
    await new Promise((r) => setTimeout(r, 20));
    bridge.handleLine(line);
    await new Promise((r) => setTimeout(r, 20));
    expect(events.some((e) => e.type === 'error' && e.error.code === 'busy')).toBe(true);
    bridge.handleLine('{"type":"cancel","id":"c","targetId":"dup"}');
    await bridge.idle();
    expect(events.at(-1)).toEqual({ type: 'chat.done', id: 'dup', status: 'cancelled' });
  });

  it('reports a missing CLI on provider.login as an error', async () => {
    const { bridge, events } = bridgeWith();
    bridge.handleLine('{"type":"provider.login","id":"l1","provider":"openai"}');
    await new Promise((r) => setTimeout(r, 30));
    expect(events[0]).toMatchObject({ type: 'error', id: 'l1' });
  });
});

// ------------------------------------------------------------------ helpers

import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A temp directory holding an empty executable named `name`, for PATH lookups. */
async function makeFakeCli(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'command-center-cli-'));
  // Adapters look for `name` (Linux, macOS) or `name.exe` (Windows) on PATH.
  const file = join(dir, process.platform === 'win32' ? `${name}.exe` : name);
  await writeFile(file, '');
  await chmod(file, 0o755);
  return dir;
}
