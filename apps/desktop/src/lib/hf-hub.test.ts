import { describe, expect, it, vi } from 'vitest';
import {
  HUB,
  HubError,
  addWarnings,
  formatBytes,
  ggufChoices,
  isMlxRepo,
  listFiles,
  modelInfo,
  parseModelReference,
  quantFromFile,
  searchModels,
  type HubModelInfo,
} from './hf-hub';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('searchModels', () => {
  it('asks the Hub for text-generation models by downloads and keeps valid entries only', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      json([
        {
          id: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
          downloads: 10,
          likes: 2,
          pipeline_tag: 'text-generation',
          tags: ['gguf'],
          gated: false,
        },
        { id: 'bad id; rm', downloads: 1 },
        { id: 'meta-llama/Llama-3.1-8B-Instruct', gated: 'manual', downloads: -5 },
        'junk',
      ]),
    );
    const out = await searchModels('  qwen  ', 'gguf', fetchMock);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin).toBe(HUB);
    expect(url.pathname).toBe('/api/models');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      search: 'qwen',
      pipeline_tag: 'text-generation',
      sort: 'downloads',
      direction: '-1',
      filter: 'gguf',
    });
    expect(out.map((m) => [m.id, m.gated, m.downloads])).toEqual([
      ['Qwen/Qwen2.5-0.5B-Instruct-GGUF', false, 10],
      ['meta-llama/Llama-3.1-8B-Instruct', 'manual', 0],
    ]);
  });

  it('has no filter for "any" and survives a non-list answer', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => json({ error: 'x' }));
    expect(await searchModels('x', 'any', fetchMock)).toEqual([]);
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.has('filter')).toBe(false);
  });
});

describe('modelInfo and listFiles', () => {
  it('reads license, parameters and files, stripping a provider suffix', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      json({
        id: 'Qwen/Qwen2.5-7B-Instruct',
        pipeline_tag: 'text-generation',
        tags: ['conversational'],
        cardData: { license: 'apache-2.0' },
        safetensors: { total: 7615616512 },
        siblings: [{ rfilename: 'config.json' }, { rfilename: 42 }],
      }),
    );
    const info = await modelInfo('Qwen/Qwen2.5-7B-Instruct:fastest', fetchMock);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${HUB}/api/models/Qwen/Qwen2.5-7B-Instruct`);
    expect(info).toMatchObject({
      license: 'apache-2.0',
      parameters: 7615616512,
      files: ['config.json'],
    });
  });

  it('turns 404 and 403 into readable errors and refuses bad ids without fetching', async () => {
    await expect(modelInfo('a/b', () => json({}, 404))).rejects.toThrow(/not found/);
    await expect(modelInfo('a/b', () => json({}, 403))).rejects.toThrow(/private or gated/);
    const fetchMock = vi.fn<typeof fetch>();
    await expect(modelInfo('../../etc', fetchMock)).rejects.toBeInstanceOf(HubError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists files with LFS sizes and skips folders', async () => {
    const files = await listFiles('a/b', () =>
      json([
        { type: 'file', path: 'README.md', size: 10 },
        { type: 'file', path: 'm-q4_k_m.gguf', size: 133, lfs: { size: 400_000_000 } },
        { type: 'directory', path: 'sub' },
      ]),
    );
    expect(files).toEqual([
      { path: 'README.md', size: 10 },
      { path: 'm-q4_k_m.gguf', size: 400_000_000 },
    ]);
  });
});

describe('GGUF quants', () => {
  it('parses quant tags from file names', () => {
    expect(quantFromFile('qwen2.5-0.5b-instruct-q4_k_m.gguf')).toBe('Q4_K_M');
    expect(quantFromFile('Llama-3.2-1B-Instruct-IQ3_XS.gguf')).toBe('IQ3_XS');
    expect(quantFromFile('model-f16.gguf')).toBe('F16');
    expect(quantFromFile('big-Q8_0-00001-of-00002.gguf')).toBe('Q8_0');
    expect(quantFromFile('weights.gguf')).toBeNull();
  });

  it('groups shards per quant, drops projector files, smallest first', () => {
    expect(
      ggufChoices([
        { path: 'm-Q8_0-00001-of-00002.gguf', size: 5 },
        { path: 'm-Q8_0-00002-of-00002.gguf', size: 5 },
        { path: 'm-Q4_K_M.gguf', size: 4 },
        { path: 'mmproj-f16.gguf', size: 1 },
        { path: 'README.md', size: 1 },
      ]),
    ).toEqual([
      { file: 'm-Q4_K_M.gguf', quant: 'Q4_K_M', size: 4 },
      { file: 'm-Q8_0-00001-of-00002.gguf', quant: 'Q8_0', size: 10 },
    ]);
  });
});

describe('references and formats', () => {
  it('accepts ids and huggingface.co links, nothing else', () => {
    expect(parseModelReference('Qwen/Qwen2.5-7B-Instruct')).toBe('Qwen/Qwen2.5-7B-Instruct');
    expect(parseModelReference(' https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/tree/main ')).toBe(
      'Qwen/Qwen2.5-7B-Instruct',
    );
    expect(parseModelReference('hf.co/bartowski/x-GGUF')).toBe('bartowski/x-GGUF');
    expect(parseModelReference('openai/gpt-oss-20b:groq')).toBe('openai/gpt-oss-20b:groq');
    for (const bad of [
      '',
      'just-a-name',
      'https://evil.com/a/b',
      'a/b c',
      'javascript:alert(1)',
      'https://huggingface.co/datasets/a/b',
      'https://huggingface.co/spaces/a/b',
    ]) {
      expect(parseModelReference(bad), bad).toBeNull();
    }
  });

  it('spots MLX repos and formats sizes', () => {
    expect(isMlxRepo({ id: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit', tags: [] })).toBe(true);
    expect(isMlxRepo({ id: 'a/b', tags: ['mlx'] })).toBe(true);
    expect(isMlxRepo({ id: 'a/b', tags: ['gguf'] })).toBe(false);
    expect(formatBytes(1_250_000_000)).toBe('1.3 GB');
    expect(formatBytes(400_000_000)).toBe('400 MB');
    expect(formatBytes(10)).toBe('1 KB');
  });
});

describe('addWarnings', () => {
  const info = (over: Partial<HubModelInfo> = {}): HubModelInfo => ({
    id: 'a/b',
    downloads: 0,
    likes: 0,
    pipelineTag: 'text-generation',
    gated: false,
    tags: [],
    license: null,
    parameters: null,
    files: [],
    ...over,
  });
  const GB = 1e9;

  it('warns about non-chat models, gating and memory', () => {
    expect(
      addWarnings(info({ pipelineTag: 'text-to-image' }), {
        route: 'cloud',
        hasToken: true,
        memoryBytes: null,
      })[0]?.text,
    ).toMatch(/not a chat model/);
    expect(
      addWarnings(info({ gated: 'manual' }), { route: 'cloud', hasToken: false, memoryBytes: null })
        .map((w) => w.text)
        .join(' '),
    ).toMatch(/gated/);
    const local = (size: number) =>
      addWarnings(info(), {
        route: 'local',
        hasToken: false,
        memoryBytes: 8 * GB,
        sizeBytes: size,
      });
    expect(local(7 * GB)[0]).toMatchObject({ level: 'warn' });
    expect(local(5 * GB)[0]).toMatchObject({ level: 'info' });
    expect(local(1 * GB)).toEqual([]);
  });

  it('reminds about a token for cloud models', () => {
    expect(addWarnings(info(), { route: 'cloud', hasToken: false, memoryBytes: null })).toEqual([
      expect.objectContaining({ level: 'info', text: expect.stringMatching(/access token/) }),
    ]);
    expect(addWarnings(info(), { route: 'cloud', hasToken: true, memoryBytes: null })).toEqual([]);
  });
});
