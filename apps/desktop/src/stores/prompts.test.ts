import { beforeEach, describe, expect, it } from 'vitest';
import { LibraryFileError } from '../lib/prompt-library';
import { createTestDb } from '../lib/sqlite-test-db';
import { createPromptsStore } from './prompts';

let db: ReturnType<typeof createTestDb>;
let store: ReturnType<typeof createPromptsStore>;

beforeEach(() => {
  db = createTestDb();
  store = createPromptsStore(() => Promise.resolve(db));
});

const input = (over = {}) => ({
  kind: 'prompt' as const,
  title: 'Review',
  tags: ['code'],
  body: 'Review {{language}}',
  ...over,
});

describe('prompts store', () => {
  it('creates, updates and deletes prompts', async () => {
    await store.getState().load();
    expect(store.getState()).toMatchObject({ loaded: true, prompts: [] });

    const created = await store.getState().create(input());
    expect(created?.title).toBe('Review');
    expect(store.getState().prompts).toHaveLength(1);

    await store.getState().update(created!.id, input({ title: 'Review v2', tags: ['a', 'b'] }));
    expect(store.getState().prompts[0]).toMatchObject({ title: 'Review v2', tags: ['a', 'b'] });

    await store.getState().remove(created!.id);
    expect(store.getState().prompts).toEqual([]);
  });

  it('exports and imports the library, merging instead of duplicating', async () => {
    await store.getState().create(input());
    await store.getState().create(input({ kind: 'system', title: 'Pirate', body: 'Arr' }));
    const json = store.getState().exportJson();
    expect(JSON.parse(json)).toMatchObject({ format: 'programish-prompts', version: 1 });

    const otherDb = createTestDb();
    const other = createPromptsStore(() => Promise.resolve(otherDb));
    expect(await other.getState().importJson(json)).toMatchObject({ added: 2 });
    expect(await other.getState().importJson(json)).toMatchObject({ added: 0 });
    expect(other.getState().prompts).toHaveLength(2);
  });

  it('rejects files that are not a library, with a readable reason', async () => {
    await expect(store.getState().importJson('not json')).rejects.toBeInstanceOf(LibraryFileError);
    await expect(store.getState().importJson('{"format":"other"}')).rejects.toBeInstanceOf(
      LibraryFileError,
    );
    expect(store.getState().prompts).toEqual([]);
  });

  it('reports a database failure instead of throwing', async () => {
    const broken = createPromptsStore(() => Promise.reject(new Error('disk gone')));
    await broken.getState().load();
    expect(broken.getState().error).toBe('disk gone');
  });
});
