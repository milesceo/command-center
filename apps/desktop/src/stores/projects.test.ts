import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '../lib/repo';
import * as prompts from '../lib/repo-prompts';
import { createTestDb } from '../lib/sqlite-test-db';
import { DEFAULT_SETTINGS } from '../lib/types';
import { createProjectsStore } from './projects';

let db: ReturnType<typeof createTestDb>;
let store: ReturnType<typeof createProjectsStore>;

beforeEach(() => {
  db = createTestDb();
  store = createProjectsStore(() => Promise.resolve(db));
});

describe('projects store', () => {
  it('creates, renames and ignores blank names', async () => {
    const project = await store.getState().create('Alpha');
    expect(project?.name).toBe('Alpha');
    await store.getState().create('   ');
    expect(store.getState().projects).toHaveLength(1);

    await store.getState().rename(project!.id, 'Beta');
    expect(store.getState().projects[0]?.name).toBe('Beta');
    await store.getState().rename(project!.id, '  ');
    expect(store.getState().projects[0]?.name).toBe('Beta');
  });

  it('stores a default system prompt with its variable values', async () => {
    const project = await store.getState().create('Alpha');
    const prompt = await prompts.createPrompt(db, {
      kind: 'system',
      title: 'Pirate',
      tags: [],
      body: 'Talk like a {{creature}}',
    });
    await store.getState().setSystemPrompt(project!.id, prompt.id, { creature: 'parrot' });
    expect(store.getState().projects[0]).toMatchObject({
      defaultSystemPromptId: prompt.id,
      defaultSystemPromptVars: { creature: 'parrot' },
    });
  });

  it('deleting a project keeps its conversations, now ungrouped', async () => {
    const project = await store.getState().create('Alpha');
    const chat = await repo.createConversation(db, { ...DEFAULT_SETTINGS, projectId: project!.id });
    await store.getState().remove(project!.id);
    expect(store.getState().projects).toEqual([]);
    expect((await repo.getConversation(db, chat.id))?.projectId).toBeNull();
  });
});
