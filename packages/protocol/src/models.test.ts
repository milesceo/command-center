import { describe, expect, it } from 'vitest';
import {
  LOCAL_RUNTIMES,
  LOCAL_RUNTIME_INFO,
  isHfRepoId,
  isLoopbackUrl,
  isLocalModelName,
  parseChatParams,
  parseLocalRunRequest,
  parseRuntimeStatuses,
  servedModelName,
} from './models';

describe('Hugging Face repo ids', () => {
  it('accepts owner/name with an optional :provider or :policy suffix', () => {
    for (const id of [
      'meta-llama/Llama-3.1-8B-Instruct',
      'Qwen/Qwen2.5-0.5B-Instruct',
      'bartowski/Llama-3.2-1B-Instruct-GGUF',
      'deepseek-ai/DeepSeek-R1:fireworks-ai',
      'openai/gpt-oss-20b:fastest',
      'a/b',
    ]) {
      expect(isHfRepoId(id), id).toBe(true);
    }
  });

  it('refuses anything else, including shell and URL tricks', () => {
    for (const id of [
      '',
      'noslash',
      '/name',
      'owner/',
      'owner/name/extra',
      'owner/na me',
      'owner/name;rm -rf ~',
      'owner/$(whoami)',
      '../etc/passwd',
      'https://huggingface.co/owner/name',
      'owner/name:',
      'owner/name:UPPER',
      '-owner/name',
      `owner/${'x'.repeat(97)}`,
    ]) {
      expect(isHfRepoId(id), id).toBe(false);
    }
  });
});

describe('local model names', () => {
  it('accepts Ollama, llama.cpp and MLX style names', () => {
    for (const name of [
      'llama3.2:1b',
      'hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M',
      'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
      'qwen2.5-0.5b-instruct-q4_k_m.gguf',
      'default',
    ]) {
      expect(isLocalModelName(name), name).toBe(true);
    }
  });

  it('refuses spaces, shell metacharacters and newlines', () => {
    for (const name of ['', 'a b', 'a;b', 'a$(b)', 'a\nb', 'a`b`', '-rf', 'x'.repeat(201)]) {
      expect(isLocalModelName(name), JSON.stringify(name)).toBe(false);
    }
  });
});

describe('loopback URLs', () => {
  it('accepts localhost addresses only', () => {
    for (const url of [
      'http://127.0.0.1:11434/v1',
      'http://localhost:8080/v1',
      'http://[::1]:1234/v1',
      'http://127.0.0.2:9000',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(true);
    }
    for (const url of [
      'http://192.168.1.10:11434/v1',
      'http://example.com/v1',
      'http://localhost.example.com/v1',
      'http://127.0.0.1.nip.io/v1',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });
});

describe('chat parameters', () => {
  it('keeps valid values and the given subset only', () => {
    expect(
      parseChatParams({
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxTokens: 512,
        contextLength: 8192,
        stop: ['</s>', '\n\n'],
        repetitionPenalty: 1.1,
      }),
    ).toEqual({
      ok: true,
      value: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxTokens: 512,
        contextLength: 8192,
        stop: ['</s>', '\n\n'],
        repetitionPenalty: 1.1,
      },
    });
    expect(parseChatParams({})).toEqual({ ok: true, value: {} });
  });

  it('refuses values out of range, of the wrong type, or unknown keys', () => {
    for (const bad of [
      { temperature: -0.1 },
      { temperature: 2.5 },
      { topP: 1.5 },
      { topK: 0 },
      { topK: 2.5 },
      { maxTokens: 0 },
      { maxTokens: 2_000_001 },
      { contextLength: 10 },
      { stop: 'x' },
      { stop: Array.from({ length: 9 }, () => 'x') },
      { stop: ['x'.repeat(65)] },
      { stop: [''] },
      { repetitionPenalty: 3 },
      { temperature: '0.5' },
      { surprise: 1 },
      null,
      [],
      'x',
    ]) {
      expect(parseChatParams(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('local.run requests', () => {
  it('accepts a Hugging Face source for each runtime', () => {
    for (const runtime of LOCAL_RUNTIMES) {
      const parsed = parseLocalRunRequest('r1', {
        runtime,
        source: { kind: 'hf', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', quant: 'Q4_K_M' },
      });
      expect(parsed.ok, runtime).toBe(true);
    }
  });

  it('accepts an absolute model file and an MLX adapter path', () => {
    expect(
      parseLocalRunRequest('r1', {
        runtime: 'llama.cpp',
        source: { kind: 'file', path: '/Users/a/Models/My Model.Q4_K_M.gguf' },
      }),
    ).toMatchObject({ ok: true, value: { type: 'local.run', runtime: 'llama.cpp' } });
    expect(
      parseLocalRunRequest('r1', {
        runtime: 'mlx',
        source: { kind: 'hf', repo: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit' },
        adapterPath: '/Users/a/adapters/mine',
      }),
    ).toMatchObject({ ok: true, value: { adapterPath: '/Users/a/adapters/mine' } });
  });

  it('refuses unknown runtimes, bad sources, relative or multi-line paths, and adapters off MLX', () => {
    const cases: unknown[] = [
      { runtime: 'vllm', source: { kind: 'hf', repo: 'a/b' } },
      { runtime: 'ollama', source: { kind: 'hf', repo: 'a b' } },
      { runtime: 'ollama', source: { kind: 'hf', repo: 'a/b', quant: 'Q4;rm' } },
      { runtime: 'ollama', source: { kind: 'file', path: 'relative.gguf' } },
      { runtime: 'ollama', source: { kind: 'file', path: '/a/b\nrm -rf ~' } },
      { runtime: 'ollama', source: { kind: 'url', url: 'http://x' } },
      { runtime: 'llama.cpp', source: { kind: 'hf', repo: 'a/b' }, adapterPath: '/x' },
      { runtime: 'mlx', source: { kind: 'hf', repo: 'a/b' }, adapterPath: 'rel' },
      { runtime: 'ollama' },
    ];
    for (const raw of cases) {
      expect(parseLocalRunRequest('r1', raw as never).ok, JSON.stringify(raw)).toBe(false);
    }
  });
});

describe('runtime statuses in a providers report', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(
      parseRuntimeStatuses([
        {
          id: 'ollama',
          installed: true,
          running: true,
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: ['llama3.2:1b'],
        },
        {
          id: 'llama.cpp',
          installed: false,
          running: false,
          baseUrl: 'http://127.0.0.1:8080/v1',
          models: [],
        },
        { id: 'vllm', installed: true, running: true, baseUrl: 'x', models: [] },
        { id: 'mlx', installed: 'yes' },
        'junk',
      ]),
    ).toEqual([
      {
        id: 'ollama',
        installed: true,
        running: true,
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: ['llama3.2:1b'],
      },
      {
        id: 'llama.cpp',
        installed: false,
        running: false,
        baseUrl: 'http://127.0.0.1:8080/v1',
        models: [],
      },
    ]);
    expect(parseRuntimeStatuses(undefined)).toBeUndefined();
  });

  it('drops model names that are not safe local names', () => {
    expect(
      parseRuntimeStatuses([
        {
          id: 'ollama',
          installed: true,
          running: true,
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: ['ok:1b', '<script>', 'a b'],
        },
      ])?.[0]?.models,
    ).toEqual(['ok:1b']);
  });
});

describe('runtime defaults', () => {
  it('has a loopback base URL and a command for every runtime', () => {
    for (const id of LOCAL_RUNTIMES) {
      const info = LOCAL_RUNTIME_INFO[id];
      expect(isLoopbackUrl(info.baseUrl), id).toBe(true);
      expect(info.command.length, id).toBeGreaterThan(0);
    }
  });
});

describe('servedModelName', () => {
  const hf = { kind: 'hf' as const, repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', quant: 'Q4_K_M' };
  const file = { kind: 'file' as const, path: '/Users/a/My Model.Q4_K_M.gguf' };

  it('names the model the way each runtime lists it', () => {
    expect(servedModelName('ollama', hf)).toBe('hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M');
    expect(servedModelName('llama.cpp', hf)).toBe('Qwen/Qwen2.5-0.5B-Instruct-GGUF');
    expect(servedModelName('lmstudio', hf)).toBe('qwen2.5-0.5b-instruct-gguf');
    expect(servedModelName('ollama', file)).toBe('my-model.q4_k_m');
    expect(servedModelName('mlx', file)).toBe('default_model');
    for (const runtime of ['ollama', 'llama.cpp', 'mlx', 'lmstudio'] as const) {
      expect(isLocalModelName(servedModelName(runtime, hf)), runtime).toBe(true);
      expect(isLocalModelName(servedModelName(runtime, file)), runtime).toBe(true);
    }
  });
});
