import { describe, expect, it } from 'vitest';
import {
  defaultName,
  draftToInput,
  fileFormat,
  localSource,
  previewCommand,
  runRequest,
  runtimesFor,
  storedSource,
  type DraftSource,
} from './model-draft';
import { validateCustomModel, type CustomModel } from './repo-models';

const gguf: DraftSource = { kind: 'hub', repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', format: 'gguf' };
const file: DraftSource = {
  kind: 'file',
  path: '/Users/a/Models/tiny.Q4_K_M.gguf',
  format: 'gguf',
};

describe('model drafts', () => {
  it('offers runtimes that can serve the format', () => {
    expect(runtimesFor(gguf)).toEqual(['ollama', 'llama.cpp', 'lmstudio']);
    expect(runtimesFor({ kind: 'hub', repo: 'mlx-community/x', format: 'mlx' })).toEqual([
      'mlx',
      'lmstudio',
    ]);
    expect(runtimesFor({ kind: 'hub', repo: 'a/b', format: 'other' })).toEqual([]);
    expect(fileFormat('/a/b.GGUF')).toBe('gguf');
    expect(fileFormat('/a/mlx-folder')).toBe('mlx');
  });

  it('builds the same command the bridge runs, quoting a path with spaces', () => {
    expect(previewCommand(runRequest('ollama', localSource(gguf, 'Q4_K_M')))).toBe(
      'ollama run hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M',
    );
    expect(
      previewCommand(runRequest('llama.cpp', { kind: 'file', path: "/Users/a/My 'x'.gguf" })),
    ).toBe(`llama-server -m '/Users/a/My '\\''x'\\''.gguf' --alias my-x --port 8080`);
    // The adapter is only for MLX-LM.
    expect(runRequest('ollama', localSource(gguf, null), '/a')).not.toHaveProperty('adapterPath');
  });

  it('names a model from its repo or file', () => {
    expect(defaultName(gguf, 'Q4_K_M')).toBe('Qwen2.5-0.5B-Instruct Q4_K_M');
    expect(defaultName(file, null)).toBe('tiny.Q4_K_M');
  });

  it('turns a draft into a model the repo accepts, for each route', () => {
    const cloud = draftToInput(
      { kind: 'hub', repo: 'openai/gpt-oss-20b:groq', format: 'other' },
      { route: 'cloud' },
      'GPT OSS',
    );
    expect(cloud).toMatchObject({
      provider: 'huggingface',
      model: 'openai/gpt-oss-20b:groq',
      hfRepo: 'openai/gpt-oss-20b',
    });
    expect(() => validateCustomModel(cloud)).not.toThrow();

    const local = draftToInput(
      gguf,
      { route: 'local', runtime: 'ollama', quant: 'Q4_K_M', adapterPath: '/ignored' },
      'Qwen',
    );
    expect(local).toMatchObject({
      provider: 'local',
      model: 'hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M',
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      quant: 'Q4_K_M',
      adapterPath: null,
    });
    expect(() => validateCustomModel(local)).not.toThrow();

    const fromFile = draftToInput(
      file,
      { route: 'local', runtime: 'llama.cpp', quant: 'Q8_0', adapterPath: null },
      'Tiny',
    );
    expect(fromFile).toMatchObject({ filePath: file.path, quant: null, hfRepo: null });
    expect(() => validateCustomModel(fromFile)).not.toThrow();
    expect(() => draftToInput(file, { route: 'cloud' }, 'x')).toThrow();
  });

  it('reads the source back from a stored model', () => {
    const stored = { ...fromInput(), filePath: null, hfRepo: 'a/b', quant: 'Q4_K_M' };
    expect(storedSource(stored)).toEqual({ kind: 'hf', repo: 'a/b', quant: 'Q4_K_M' });
    expect(storedSource({ ...stored, filePath: '/m.gguf' })).toEqual({
      kind: 'file',
      path: '/m.gguf',
    });
    expect(storedSource({ ...stored, provider: 'huggingface' })).toBeNull();
    expect(storedSource({ ...stored, hfRepo: null })).toBeNull();
  });
});

function fromInput(): CustomModel {
  return {
    ...draftToInput(
      gguf,
      { route: 'local', runtime: 'ollama', quant: null, adapterPath: null },
      'x',
    ),
    id: '1',
    createdAt: 0,
    updatedAt: 0,
  };
}
