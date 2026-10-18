import type { BridgeEvent, ChatRequest, LocalRunRequest } from '@command-center/protocol';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { HF_CHAT_URL, huggingfaceProvider } from './huggingface';
import {
  LLAMA_PORT,
  MLX_PORT,
  localProvider,
  confirmFirst,
  nameFromFile,
  runCommandLine,
  runtimeStatuses,
} from './local';
import type { GuiPathDeps, SpawnFn } from './process';
import type { ProviderContext } from './types';

const NO_GUI_PATH: GuiPathDeps = { loginShellPath: () => null, listDir: () => [] };

/**
 * A fetch Response whose body streams the given SSE chunks, then ends (or hangs). Like a real
 * fetch, aborting the request's signal errors the body.
 */
function sse(
  chunks: string[],
  { hang = false, signal }: { hang?: boolean; signal?: AbortSignal | null } = {},
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      if (!hang) controller.close();
      signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const textChunk = (text: string) => data({ choices: [{ delta: { content: text } }] });

function context(fetchImpl: typeof fetch, over: Partial<ProviderContext> = {}) {
  const events: BridgeEvent[] = [];
  const ctx: ProviderContext = {
    emit: (e) => events.push(e),
    getQuery: () => Promise.reject(new Error('unused')),
    spawn: (() => {
      throw new Error('unused');
    }) as SpawnFn,
    fetch: fetchImpl,
    env: { PATH: '/nowhere' },
    platform: 'linux',
    gui: NO_GUI_PATH,
    ...over,
  };
  return { ctx, events };
}

const chat = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  type: 'chat',
  id: 'c1',
  tools: 'off',
  messages: [{ role: 'user', content: 'hi' }],
  ...over,
});

describe('Hugging Face adapter', () => {
  it('streams through the router with the token, model and supported params only', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sse([
        textChunk('Hel'),
        textChunk('lo'),
        data({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } }),
        'data: [DONE]\n\n',
      ]),
    );
    const { ctx, events } = context(fetchMock);
    await huggingfaceProvider.chat(
      chat({
        provider: 'huggingface',
        model: 'Qwen/Qwen2.5-7B-Instruct:fastest',
        apiKey: 'hf_secret',
        params: {
          temperature: 0.3,
          topK: 40,
          repetitionPenalty: 1.1,
          stop: ['a', 'b', 'c', 'd', 'e'],
          maxTokens: 64,
        },
      }),
      ctx,
    ).done;

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(HF_CHAT_URL);
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer hf_secret');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'Qwen/Qwen2.5-7B-Instruct:fastest',
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.3,
      max_tokens: 64,
      stop: ['a', 'b', 'c', 'd'],
    });
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('repetition_penalty');
    expect(
      events.filter((e) => e.type === 'chat.text').map((e) => (e as { text: string }).text),
    ).toEqual(['Hel', 'lo']);
    expect(events.at(-1)).toMatchObject({
      type: 'chat.done',
      status: 'completed',
      usage: { inputTokens: 7, outputTokens: 2 },
    });
    // The token never appears in any event.
    expect(JSON.stringify(events)).not.toContain('hf_secret');
  });

  it('asks for a token, and for a valid repo id, before calling anything', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const { ctx, events } = context(fetchMock);
    await huggingfaceProvider.chat(chat({ model: 'a/b' }), ctx).done;
    await huggingfaceProvider.chat(chat({ model: 'not a repo', apiKey: 'k' }), ctx).done;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.map((e) => e.type === 'error' && e.error.code)).toEqual([
      'auth_required',
      'invalid_request',
    ]);
  });

  it('maps an auth error and a rate limit to protocol codes', async () => {
    for (const [status, code] of [
      [401, 'auth_required'],
      [403, 'auth_required'],
      [429, 'rate_limited'],
      [404, 'model_not_found'],
      [503, 'overloaded'],
    ] as const) {
      const { ctx, events } = context(async () => new Response('nope', { status }));
      await huggingfaceProvider.chat(chat({ model: 'a/b', apiKey: 'k' }), ctx).done;
      expect(events, String(status)).toEqual([
        expect.objectContaining({
          type: 'error',
          id: 'c1',
          error: expect.objectContaining({ code }),
        }),
      ]);
    }
  });

  it('skips malformed chunks and reports an error chunk once', async () => {
    const { ctx, events } = context(async () =>
      sse([
        'data: {not json\n\n',
        textChunk('ok'),
        data({ error: { message: 'model overloaded' } }),
        textChunk('never'),
      ]),
    );
    await huggingfaceProvider.chat(chat({ model: 'a/b', apiKey: 'k' }), ctx).done;
    expect(events.map((e) => e.type)).toEqual(['chat.text', 'error']);
    expect(events[1]).toMatchObject({ error: { message: 'model overloaded' } });
  });

  it('cancels mid-stream with a cancelled done', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
      sse([textChunk('partial')], { hang: true, signal: init?.signal ?? null }),
    );
    const { ctx, events } = context(fetchMock);
    const handle = huggingfaceProvider.chat(chat({ model: 'a/b', apiKey: 'k' }), ctx);
    await vi.waitFor(() => expect(events.some((e) => e.type === 'chat.text')).toBe(true));
    handle.cancel();
    await handle.done;
    expect(events.at(-1)).toMatchObject({ type: 'chat.done', status: 'cancelled' });
  });

  it('reports signed in when a token is stored', async () => {
    const { ctx } = context(vi.fn<typeof fetch>());
    expect(await huggingfaceProvider.authStatus(ctx, true)).toMatchObject({
      state: 'signed_in',
      via: 'apiKey',
    });
    expect(await huggingfaceProvider.authStatus(ctx, false)).toMatchObject({ state: 'signed_out' });
  });
});

describe('local adapter: chat', () => {
  it('streams from the given loopback server and sends top_k and the repetition penalty', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse([textChunk('hi'), 'data: [DONE]\n\n']));
    const { ctx, events } = context(fetchMock);
    await localProvider.chat(
      chat({
        provider: 'local',
        model: 'llama3.2:1b',
        baseUrl: 'http://127.0.0.1:11434/v1/',
        params: { topK: 20, repetitionPenalty: 1.05 },
      }),
      ctx,
    ).done;
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'llama3.2:1b',
      top_k: 20,
      repetition_penalty: 1.05,
    });
    expect(events.at(-1)).toMatchObject({ type: 'chat.done', status: 'completed' });
  });

  it('defaults to Ollama and refuses a remote server unless allowed', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse(['data: [DONE]\n\n']));
    const { ctx, events } = context(fetchMock);
    await localProvider.chat(chat({ model: 'm' }), ctx).done;
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:11434/v1/chat/completions');

    await localProvider.chat(chat({ model: 'm', baseUrl: 'http://10.0.0.5:11434/v1' }), ctx).done;
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'invalid_request' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await localProvider.chat(
      chat({ model: 'm', baseUrl: 'http://10.0.0.5:11434/v1', allowRemote: true }),
      ctx,
    ).done;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses redirects on loopback chats, and follows them only when remote is allowed', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse(['data: [DONE]\n\n']));
    const { ctx } = context(fetchMock);
    await localProvider.chat(chat({ model: 'm', baseUrl: 'http://127.0.0.1:8080/v1' }), ctx).done;
    await localProvider.chat(chat({ model: 'm' }), ctx).done;
    expect(fetchMock.mock.calls[0]![1]?.redirect).toBe('error');
    expect(fetchMock.mock.calls[1]![1]?.redirect).toBe('error');

    await localProvider.chat(
      chat({ model: 'm', baseUrl: 'http://10.0.0.5:11434/v1', allowRemote: true }),
      ctx,
    ).done;
    expect(fetchMock.mock.calls[2]![1]?.redirect).toBeUndefined();
  });

  it('refuses an unsafe model name', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const { ctx, events } = context(fetchMock);
    await localProvider.chat(chat({ model: 'a b; rm' }), ctx).done;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ type: 'error' });
  });
});

describe('local adapter: runtimes', () => {
  it('probes each runtime and keeps only safe model names', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).startsWith('http://127.0.0.1:11434/')) {
        return new Response(JSON.stringify({ data: [{ id: 'llama3.2:1b' }, { id: '<script>' }] }));
      }
      throw new Error('connection refused');
    });
    const { ctx } = context(fetchMock);
    const statuses = await runtimeStatuses(ctx);
    expect(statuses.map((s) => [s.id, s.running])).toEqual([
      ['ollama', true],
      ['llama.cpp', false],
      ['mlx', false],
      ['lmstudio', false],
    ]);
    expect(statuses[0]!.models).toEqual(['llama3.2:1b']);
    const auth = await localProvider.authStatus(ctx, false);
    expect(auth.state).toBe('signed_in');
    expect(auth.runtimes).toHaveLength(4);
  });

  it('never follows a redirect when probing a runtime', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"data":[]}'));
    const { ctx } = context(fetchMock);
    await runtimeStatuses(ctx);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(init?.redirect, String(url)).toBe('error');
      expect(init?.signal, String(url)).toBeInstanceOf(AbortSignal);
    }
  });

  it('builds a quoted serve command for every runtime and source', () => {
    const hf = (runtime: LocalRunRequest['runtime'], quant?: string): LocalRunRequest => ({
      type: 'local.run',
      id: 'r',
      runtime,
      source: {
        kind: 'hf',
        repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
        ...(quant ? { quant } : {}),
      },
    });
    const file = (runtime: LocalRunRequest['runtime']): LocalRunRequest => ({
      type: 'local.run',
      id: 'r',
      runtime,
      source: { kind: 'file', path: "/Users/a/My Models/it's.Q4_K_M.gguf" },
    });
    expect(runCommandLine(hf('ollama', 'Q4_K_M'), '/usr/local/bin/ollama')).toBe(
      '/usr/local/bin/ollama run hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M',
    );
    expect(runCommandLine(hf('llama.cpp'), '/opt/homebrew/bin/llama-server')).toBe(
      `/opt/homebrew/bin/llama-server -hf bartowski/Llama-3.2-1B-Instruct-GGUF --port ${LLAMA_PORT}`,
    );
    expect(
      runCommandLine({ ...hf('mlx'), adapterPath: '/Users/a/adapter' }, '/x/mlx_lm.server'),
    ).toBe(
      `/x/mlx_lm.server --model bartowski/Llama-3.2-1B-Instruct-GGUF --port ${MLX_PORT} --adapter-path /Users/a/adapter`,
    );
    expect(runCommandLine(file('llama.cpp'), '/b/llama-server')).toBe(
      `/b/llama-server -m '/Users/a/My Models/it'\\''s.Q4_K_M.gguf' --alias it-s.q4_k_m --port ${LLAMA_PORT}`,
    );
    expect(runCommandLine(file('ollama'), '/b/ollama')).toMatch(/^\/bin\/sh -c '/);
    expect(runCommandLine(hf('lmstudio'), '/b/lms')).toBe(
      '/b/lms get bartowski/Llama-3.2-1B-Instruct-GGUF && /b/lms server start',
    );
  });

  it('derives safe names from file names', () => {
    expect(nameFromFile('/a/Qwen2.5 0.5B Instruct.Q4_K_M.gguf')).toBe(
      'qwen2.5-0.5b-instruct.q4_k_m',
    );
    expect(nameFromFile('/a/$(rm -rf ~).gguf')).toBe('rm-rf');
    expect(nameFromFile('/a/a  --  b.gguf')).toBe('a-b');
    expect(nameFromFile('/a/.gguf')).toBe('model');
  });

  it('says when the runtime is missing', async () => {
    const request: LocalRunRequest = {
      type: 'local.run',
      id: 'r',
      runtime: 'llama.cpp',
      source: { kind: 'hf', repo: 'a/b' },
    };
    // Linux: no macOS PATH extension, so only the given PATH is searched.
    const missing = context(vi.fn<typeof fetch>(), { env: { PATH: '/nowhere' } }).ctx;
    await expect(localProvider.run!(request, missing)).rejects.toThrow(
      /llama\.cpp is not installed/,
    );
  });

  // The stand-in runtime is a POSIX script; Windows looks for an .exe instead.
  it.skipIf(process.platform === 'win32')('shows the command off macOS', async () => {
    const request: LocalRunRequest = {
      type: 'local.run',
      id: 'r',
      runtime: 'llama.cpp',
      source: { kind: 'hf', repo: 'a/b' },
    };
    const dir = mkdtempSync(join(tmpdir(), 'cc-runtime-'));
    writeFileSync(join(dir, 'llama-server'), '#!/bin/sh\n');
    chmodSync(join(dir, 'llama-server'), 0o755);
    const found = context(vi.fn<typeof fetch>(), { env: { PATH: dir } }).ctx;
    await expect(localProvider.run!(request, found)).rejects.toThrow(
      `Run this in a terminal: ${join(dir, 'llama-server')} -hf a/b --port ${LLAMA_PORT}`,
    );
  });
});

describe.skipIf(process.platform === 'win32')('the Ollama file command in a real shell', () => {
  it('writes a Modelfile naming the exact path, then creates and runs the model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-ollama-'));
    const log = join(dir, 'log');
    const fake = join(dir, 'ollama');
    // A stand-in that records its arguments and, for `create`, the Modelfile it was given.
    writeFileSync(
      fake,
      `#!/bin/sh\necho "ARGS:$*" >> '${log}'\n[ "$1" = create ] && cat "$4" >> '${log}'\nexit 0\n`,
    );
    chmodSync(fake, 0o755);
    const path = "/Users/a/My Models/it's $(touch pwned).Q4_K_M.gguf";
    const line = runCommandLine(
      { type: 'local.run', id: 'r', runtime: 'ollama', source: { kind: 'file', path } },
      fake,
    );
    // The user's shell runs the line; fish users get the same result because /bin/sh runs it.
    execFileSync('/bin/sh', ['-c', line], { cwd: dir });
    const out = execFileSync('cat', [log], { encoding: 'utf8' });
    expect(out).toContain(`FROM ${path}`);
    expect(out).toMatch(/ARGS:create \S+ -f \S+\/Modelfile/);
    expect(out).toMatch(/ARGS:run \S+/);
    // The `$(...)` in the file name stayed text: nothing ran.
    expect(existsSync(join(dir, 'pwned'))).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('Run in Terminal waits for Enter', () => {
  const line = "printf '%s|' it\\'s 'two words'";
  it('shows the exact line, then runs it when Enter is pressed', () => {
    const out = execFileSync('/bin/sh', ['-c', confirmFirst(line)], {
      input: '\n',
      encoding: 'utf8',
    });
    expect(out).toContain(`Command Center will run:\n\n  ${line}\n`);
    expect(out).toContain("it's|two words|");
  });
  it('runs nothing when the window closes without Enter', () => {
    const result = spawnSync('/bin/sh', ['-c', confirmFirst(line)], {
      input: '',
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('two words|');
  });
});
