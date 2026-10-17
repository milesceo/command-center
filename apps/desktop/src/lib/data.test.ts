import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from './repo';
import * as projects from './repo-projects';
import * as prompts from './repo-prompts';
import * as usage from './repo-usage';
import { clearData, countData, exportAll } from './data';
import { createTestDb } from './sqlite-test-db';
import { DEFAULT_SETTINGS } from './types';
import { message } from './test-fixtures';

let db: ReturnType<typeof createTestDb>;

async function seed() {
  const project = await projects.createProject(db, 'Alpha');
  const prompt = await prompts.createPrompt(db, {
    kind: 'system',
    title: 'P',
    tags: [],
    body: 'b',
  });
  const chat = await repo.createConversation(db, {
    ...DEFAULT_SETTINGS,
    projectId: project.id,
    systemPromptId: prompt.id,
  });
  await repo.insertMessage(db, message({ conversationId: chat.id, content: 'hello' }));
  await usage.recordUsage(db, [
    {
      id: 'u1',
      createdAt: 1,
      conversationId: chat.id,
      messageId: null,
      model: 'm',
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: null,
    },
  ]);
  return { project, prompt, chat };
}

beforeEach(() => {
  db = createTestDb();
});

describe('data export and clear', () => {
  it('exports every table with a format marker', async () => {
    await seed();
    const file = await exportAll(db, new Date('2026-10-14T00:00:00Z'));
    expect(file).toMatchObject({
      format: 'command-center-data',
      version: 1,
      exportedAt: '2026-10-14T00:00:00.000Z',
    });
    expect(file.tables.conversations).toHaveLength(1);
    expect(file.tables.messages[0]).toMatchObject({ content: 'hello' });
    expect(file.tables.prompts).toHaveLength(1);
    expect(file.tables.projects).toHaveLength(1);
    expect(file.tables.usage_log).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });

  it('counts what is stored', async () => {
    await seed();
    expect(await countData(db)).toEqual({
      conversations: 1,
      messages: 1,
      prompts: 1,
      projects: 1,
      usageRows: 1,
    });
  });

  it('clearing usage leaves chats and the library alone', async () => {
    await seed();
    await clearData(db, 'usage');
    expect(await countData(db)).toEqual({
      conversations: 1,
      messages: 1,
      prompts: 1,
      projects: 1,
      usageRows: 0,
    });
  });

  it('clearing prompts and projects ungroups chats instead of deleting them', async () => {
    const { chat } = await seed();
    await clearData(db, 'prompts');
    const after = await repo.getConversation(db, chat.id);
    expect(after).toMatchObject({ projectId: null, systemPromptId: null });
    expect(await countData(db)).toMatchObject({
      conversations: 1,
      prompts: 0,
      projects: 0,
      usageRows: 1,
    });
  });

  it('clearing everything empties every table', async () => {
    await seed();
    await clearData(db, 'everything');
    expect(await countData(db)).toEqual({
      conversations: 0,
      messages: 0,
      prompts: 0,
      projects: 0,
      usageRows: 0,
    });
  });
});
