import { beforeEach, describe, expect, it } from 'vitest';
import { clearData, exportAll } from './data';
import type { Db } from './db';
import * as models from './repo-models';
import { createTestDb } from './sqlite-test-db';

let db: Db;
beforeEach(() => {
  db = createTestDb();
});

const hf = (over: Partial<models.CustomModelInput> = {}): models.CustomModelInput => ({
  provider: 'huggingface',
  model: 'Qwen/Qwen2.5-7B-Instruct:fastest',
  displayName: '  Qwen 7B  ',
  hfRepo: 'Qwen/Qwen2.5-7B-Instruct',
  runtime: null,
  baseUrl: null,
  quant: null,
  filePath: null,
  adapterPath: null,
  systemPrompt: '   ',
  params: { temperature: 0.4 },
  tags: [' code ', '#code', 'Fast'],
  ...over,
});

const local = (over: Partial<models.CustomModelInput> = {}): models.CustomModelInput => ({
  provider: 'local',
  model: 'hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M',
  displayName: 'Llama 1B',
  hfRepo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
  runtime: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  quant: 'Q4_K_M',
  filePath: null,
  adapterPath: null,
  systemPrompt: 'Be brief.',
  params: { topK: 40, contextLength: 4096, stop: ['</s>'] },
  tags: [],
  ...over,
});

describe('custom models', () => {
  it('creates, lists, updates and deletes, normalizing name, prompt and tags', async () => {
    const a = await models.createCustomModel(db, hf(), 10);
    expect(a).toMatchObject({ displayName: 'Qwen 7B', systemPrompt: null, tags: ['code', 'Fast'] });
    const b = await models.createCustomModel(db, local(), 20);
    expect((await models.listCustomModels(db)).map((m) => m.displayName)).toEqual([
      'Llama 1B',
      'Qwen 7B',
    ]);
    expect(await models.getCustomModel(db, b.id)).toEqual(b);

    const updated = await models.updateCustomModel(
      db,
      a.id,
      hf({ displayName: 'Qwen', params: {} }),
      30,
    );
    expect(updated).toMatchObject({
      displayName: 'Qwen',
      params: {},
      createdAt: 10,
      updatedAt: 30,
    });
    expect(await models.updateCustomModel(db, 'missing', hf())).toBeNull();

    await models.deleteCustomModel(db, a.id);
    expect((await models.listCustomModels(db)).map((m) => m.id)).toEqual([b.id]);
  });

  it('refuses records the bridge would refuse', async () => {
    const bad: Partial<models.CustomModelInput>[] = [
      { displayName: '   ' },
      { model: 'not a repo' },
      { model: 'owner/name;rm' },
      { hfRepo: 'x' },
      { params: { temperature: 7 } as never },
      { quant: 'Q4 K' },
    ];
    for (const over of bad) {
      await expect(models.createCustomModel(db, hf(over)), JSON.stringify(over)).rejects.toThrow(
        models.CustomModelError,
      );
    }
    const badLocal: Partial<models.CustomModelInput>[] = [
      { runtime: null },
      { baseUrl: 'ftp://x' },
      { model: 'a b' },
      { filePath: 'relative.gguf' },
      { adapterPath: '/x' }, // ollama
      { runtime: 'mlx', adapterPath: 'relative' },
    ];
    for (const over of badLocal) {
      await expect(models.createCustomModel(db, local(over)), JSON.stringify(over)).rejects.toThrow(
        models.CustomModelError,
      );
    }
    expect(await models.listCustomModels(db)).toEqual([]);
  });

  it('keeps an MLX adapter and a local file path', async () => {
    const m = await models.createCustomModel(
      db,
      local({
        runtime: 'mlx',
        model: 'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
        baseUrl: 'http://127.0.0.1:8081/v1',
        adapterPath: '/Users/a/adapters/mine',
        filePath: null,
      }),
    );
    expect(m.adapterPath).toBe('/Users/a/adapters/mine');
    const f = await models.createCustomModel(
      db,
      local({
        runtime: 'llama.cpp',
        model: 'my-model',
        filePath: '/Users/a/My Model.gguf',
        hfRepo: null,
      }),
    );
    expect(f.filePath).toBe('/Users/a/My Model.gguf');
  });

  it('survives corrupt JSON columns', async () => {
    const m = await models.createCustomModel(db, hf());
    await db.execute('UPDATE custom_models SET params = ?, tags = ? WHERE id = ?', [
      '{bad',
      '7',
      m.id,
    ]);
    expect(await models.getCustomModel(db, m.id)).toMatchObject({ params: {}, tags: [] });
    await db.execute('UPDATE custom_models SET params = ? WHERE id = ?', [
      '{"temperature":99}',
      m.id,
    ]);
    expect((await models.getCustomModel(db, m.id))?.params).toEqual({});
  });

  it('is part of the data export and of "erase everything"', async () => {
    await models.createCustomModel(db, hf());
    expect((await exportAll(db)).tables.custom_models).toHaveLength(1);
    await clearData(db, 'everything');
    expect(await models.listCustomModels(db)).toEqual([]);
  });
});
