import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import * as repo from './repo';
import * as projects from './repo-projects';
import * as prompts from './repo-prompts';
import { createTestDb } from './sqlite-test-db';
import { settings } from './test-fixtures';
import type { Prompt } from './types';

let db: Db;
beforeEach(() => {
  db = createTestDb();
});

const input = (over: Partial<prompts.PromptInput> = {}): prompts.PromptInput => ({
  kind: 'prompt',
  title: 'Review',
  body: 'Review {{language}} code',
  tags: ['code'],
  ...over,
});

describe('prompt CRUD', () => {
  it('creates, reads, updates and deletes', async () => {
    const p = await prompts.createPrompt(
      db,
      input({ title: '  Review  ', tags: [' code ', '#code', 'Style'] }),
      100,
    );
    expect(p).toMatchObject({
      title: 'Review',
      tags: ['code', 'Style'],
      createdAt: 100,
      updatedAt: 100,
    });
    expect(await prompts.getPrompt(db, p.id)).toEqual(p);

    await prompts.updatePrompt(
      db,
      p.id,
      input({ kind: 'system', title: 'Strict', body: 'Be strict', tags: [] }),
      200,
    );
    expect(await prompts.getPrompt(db, p.id)).toMatchObject({
      kind: 'system',
      title: 'Strict',
      body: 'Be strict',
      tags: [],
      createdAt: 100,
      updatedAt: 200,
    });

    await prompts.deletePrompt(db, p.id);
    expect(await prompts.getPrompt(db, p.id)).toBeNull();
  });

  it('lists alphabetically ignoring case', async () => {
    for (const title of ['beta', 'Alpha', 'gamma'])
      await prompts.createPrompt(db, input({ title }));
    expect((await prompts.listPrompts(db)).map((p) => p.title)).toEqual(['Alpha', 'beta', 'gamma']);
  });

  it('rejects an unknown kind at the database level', async () => {
    await expect(prompts.createPrompt(db, input({ kind: 'weird' as 'prompt' }))).rejects.toThrow();
  });

  it('survives a corrupt tags column', async () => {
    const p = await prompts.createPrompt(db, input());
    await db.execute('UPDATE prompts SET tags = ? WHERE id = ?', ['{not json', p.id]);
    expect((await prompts.getPrompt(db, p.id))?.tags).toEqual([]);
  });
});

describe('searchPrompts', () => {
  const mk = (
    title: string,
    body = '',
    tags: string[] = [],
    kind: Prompt['kind'] = 'prompt',
  ): Prompt => ({ id: title, kind, title, body, tags, createdAt: 1, updatedAt: 1 });
  const lib = [
    mk('Code review', 'x', ['style']),
    mk('Explain code', 'plain'),
    mk('Refactor', 'make the code cleaner', ['code']),
    mk('Terse', 'short', [], 'system'),
  ];

  it('ranks title prefix, title substring, tag, then body', () => {
    expect(prompts.searchPrompts(lib, 'code').map((p) => p.title)).toEqual([
      'Code review',
      'Explain code',
      'Refactor',
    ]);
    expect(prompts.searchPrompts(lib, 'sty').map((p) => p.title)).toEqual(['Code review']);
    expect(prompts.searchPrompts(lib, 'cleaner').map((p) => p.title)).toEqual(['Refactor']);
  });
  it('can be limited to one kind, and an empty query lists everything of that kind', () => {
    expect(prompts.searchPrompts(lib, '', 'system').map((p) => p.title)).toEqual(['Terse']);
    expect(prompts.searchPrompts(lib, '', 'prompt')).toHaveLength(3);
    expect(prompts.searchPrompts(lib, 'zzz')).toEqual([]);
  });
});

describe('importPrompts', () => {
  const item = (
    id: string,
    over: Partial<{
      title: string;
      body: string;
      updatedAt: number;
      kind: 'prompt' | 'system';
    }> = {},
  ) => ({
    id,
    kind: 'prompt' as const,
    title: `T ${id}`,
    body: `B ${id}`,
    tags: ['x'],
    createdAt: 10,
    updatedAt: 10,
    ...over,
  });

  it('adds new prompts keeping their ids and timestamps', async () => {
    const result = await prompts.importPrompts(db, [item('a'), item('b')], 999);
    expect(result).toEqual({ added: 2, updated: 0, skipped: 0 });
    expect(await prompts.getPrompt(db, 'a')).toMatchObject({
      createdAt: 10,
      updatedAt: 10,
      tags: ['x'],
    });
  });

  it('updates a prompt that was edited more recently in the file, otherwise skips it', async () => {
    await prompts.importPrompts(db, [item('a')]);
    expect(await prompts.importPrompts(db, [item('a', { title: 'Newer', updatedAt: 50 })])).toEqual(
      { added: 0, updated: 1, skipped: 0 },
    );
    expect((await prompts.getPrompt(db, 'a'))?.title).toBe('Newer');
    expect(await prompts.importPrompts(db, [item('a', { title: 'Older', updatedAt: 20 })])).toEqual(
      { added: 0, updated: 0, skipped: 1 },
    );
    expect((await prompts.getPrompt(db, 'a'))?.title).toBe('Newer');
  });

  it('skips duplicates that only differ by id, including within the file', async () => {
    await prompts.createPrompt(db, input({ title: 'Same', body: 'Body' }));
    const result = await prompts.importPrompts(db, [
      item('x', { title: 'Same', body: 'Body' }),
      item('y'),
      item('z', { title: 'T y', body: 'B y' }),
    ]);
    expect(result).toEqual({ added: 1, updated: 0, skipped: 2 });
  });

  it('round-trips with export', async () => {
    const created = await prompts.createPrompt(db, input({ tags: ['a', 'b'] }));
    const { buildLibraryFile, parseLibraryFile } = await import('./prompt-library');
    const text = JSON.stringify(buildLibraryFile(await prompts.listPrompts(db)));
    const fresh = createTestDb();
    await prompts.importPrompts(fresh, parseLibraryFile(text));
    expect(await prompts.listPrompts(fresh)).toEqual([created]);
  });
});

describe('projects', () => {
  it('creates, renames, assigns a default system prompt and deletes', async () => {
    const sys = await prompts.createPrompt(
      db,
      input({ kind: 'system', title: 'Terse', body: 'Be terse about {{topic}}' }),
    );
    const project = await projects.createProject(db, '  Website  ', 5);
    expect(project).toMatchObject({ name: 'Website', defaultSystemPromptId: null });
    await projects.renameProject(db, project.id, 'Website v2', 6);
    await projects.setProjectSystemPrompt(db, project.id, sys.id, { topic: 'CSS' }, 7);
    expect(await projects.getProject(db, project.id)).toMatchObject({
      name: 'Website v2',
      defaultSystemPromptId: sys.id,
      defaultSystemPromptVars: { topic: 'CSS' },
      updatedAt: 7,
    });
    expect((await projects.listProjects(db)).map((p) => p.name)).toEqual(['Website v2']);
    await projects.deleteProject(db, project.id);
    expect(await projects.getProject(db, project.id)).toBeNull();
  });

  it('keeps conversations when their project is deleted, and when a prompt is deleted', async () => {
    const sys = await prompts.createPrompt(db, input({ kind: 'system' }));
    const project = await projects.createProject(db, 'P');
    await projects.setProjectSystemPrompt(db, project.id, sys.id, {});
    const c = await repo.createConversation(
      db,
      settings({ projectId: project.id, systemPromptId: sys.id, systemPromptVars: { a: 'b' } }),
    );
    expect(await repo.getConversation(db, c.id)).toMatchObject({
      projectId: project.id,
      systemPromptId: sys.id,
      systemPromptVars: { a: 'b' },
    });

    await prompts.deletePrompt(db, sys.id);
    expect(await repo.getConversation(db, c.id)).toMatchObject({
      projectId: project.id,
      systemPromptId: null,
    });
    expect((await projects.getProject(db, project.id))?.defaultSystemPromptId).toBeNull();

    await projects.deleteProject(db, project.id);
    expect(await repo.getConversation(db, c.id)).toMatchObject({ projectId: null });
  });
});
