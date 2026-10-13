import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import * as repo from './repo';
import { createTestDb } from './sqlite-test-db';
import { DEFAULT_SETTINGS, type Message } from './types';

let db: Db;
beforeEach(() => {
  db = createTestDb();
});

function msg(conversationId: string, over: Partial<Message> = {}): Message {
  return {
    id: crypto.randomUUID(),
    conversationId,
    role: 'user',
    content: 'hello',
    attachments: [],
    status: 'complete',
    error: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    createdAt: 1,
    ...over,
  };
}

describe('schema', () => {
  it('rejects unknown roles, statuses and tool modes, and orphan messages', async () => {
    const c = await repo.createConversation(db, DEFAULT_SETTINGS);
    await expect(repo.insertMessage(db, msg(c.id, { role: 'robot' as 'user' }))).rejects.toThrow();
    await expect(
      repo.insertMessage(db, msg(c.id, { status: 'weird' as 'complete' })),
    ).rejects.toThrow();
    await expect(repo.insertMessage(db, msg('missing'))).rejects.toThrow();
    await expect(
      repo.updateSettings(db, c.id, { ...DEFAULT_SETTINGS, toolsMode: 'all' as 'off' }),
    ).rejects.toThrow();
  });
});

describe('conversations', () => {
  it('creates with settings and reads them back', async () => {
    const created = await repo.createConversation(
      db,
      { model: 'opus', systemPrompt: 'be terse', toolsMode: 'readonly', cwd: '/repo' },
      100,
    );
    expect(await repo.getConversation(db, created.id)).toEqual(created);
  });

  it('lists pinned first, then most recently updated', async () => {
    const a = await repo.createConversation(db, DEFAULT_SETTINGS, 1);
    const b = await repo.createConversation(db, DEFAULT_SETTINGS, 2);
    const c = await repo.createConversation(db, DEFAULT_SETTINGS, 3);
    await repo.setPinned(db, a.id, true);
    expect((await repo.listConversations(db)).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    await repo.touchConversation(db, b.id, 10);
    expect((await repo.listConversations(db)).map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });

  it('renames and updates settings', async () => {
    const c = await repo.createConversation(db, DEFAULT_SETTINGS);
    await repo.renameConversation(db, c.id, 'Renamed');
    await repo.updateSettings(db, c.id, {
      model: 'haiku',
      systemPrompt: 'x',
      toolsMode: 'off',
      cwd: null,
    });
    expect(await repo.getConversation(db, c.id)).toMatchObject({
      title: 'Renamed',
      model: 'haiku',
      systemPrompt: 'x',
    });
  });

  it('deleting a conversation removes its messages', async () => {
    const c = await repo.createConversation(db, DEFAULT_SETTINGS);
    await repo.insertMessage(db, msg(c.id));
    await repo.deleteConversation(db, c.id);
    expect(await repo.getConversation(db, c.id)).toBeNull();
    expect(await db.select('SELECT * FROM messages')).toEqual([]);
  });
});

describe('messages', () => {
  it('round-trips attachments, errors and usage', async () => {
    const c = await repo.createConversation(db, DEFAULT_SETTINGS);
    const m = msg(c.id, {
      role: 'assistant',
      attachments: [{ name: 'a.ts', text: 'x' }],
      status: 'error',
      error: { code: 'usage_limit', message: 'm', resetsAt: 5, limitType: 'five_hour' },
      model: 'claude-x',
      inputTokens: 3,
      outputTokens: 4,
    });
    await repo.insertMessage(db, m);
    expect(await repo.listMessages(db, c.id)).toEqual([m]);
  });

  it('keeps insert order even when timestamps tie', async () => {
    const c = await repo.createConversation(db, DEFAULT_SETTINGS);
    const ids = ['a', 'b', 'c'].map((content) => msg(c.id, { content, createdAt: 7 }));
    for (const m of ids) await repo.insertMessage(db, m);
    expect((await repo.listMessages(db, c.id)).map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });

  it('rewinds history from a message onward, only within its conversation', async () => {
    const c = await repo.createConversation(db, DEFAULT_SETTINGS);
    const other = await repo.createConversation(db, DEFAULT_SETTINGS);
    const [m1, m2, m3] = ['1', '2', '3'].map((content) => msg(c.id, { content }));
    for (const m of [m1, m2, m3] as Message[]) await repo.insertMessage(db, m);
    await repo.insertMessage(db, msg(other.id, { content: 'keep' }));
    await repo.deleteMessagesFrom(db, c.id, (m2 as Message).id);
    expect((await repo.listMessages(db, c.id)).map((m) => m.content)).toEqual(['1']);
    expect(await repo.listMessages(db, other.id)).toHaveLength(1);
  });
});

describe('search', () => {
  it('finds by title or message content and flags title matches', async () => {
    const a = await repo.createConversation(db, DEFAULT_SETTINGS, 1);
    const b = await repo.createConversation(db, DEFAULT_SETTINGS, 2);
    await repo.renameConversation(db, a.id, 'Rust lifetimes');
    await repo.insertMessage(db, msg(b.id, { content: 'why does my rust build fail?' }));
    const found = await repo.listConversations(db, 'RUST');
    expect(found.map((c) => [c.id, c.titleMatch])).toEqual([
      [b.id, false],
      [a.id, true],
    ]);
    expect(await repo.listConversations(db, 'nothing-here')).toEqual([]);
  });

  it('treats LIKE wildcards literally', async () => {
    const a = await repo.createConversation(db, DEFAULT_SETTINGS);
    const b = await repo.createConversation(db, DEFAULT_SETTINGS);
    await repo.renameConversation(db, a.id, '100% done');
    await repo.renameConversation(db, b.id, 'a_b');
    expect((await repo.listConversations(db, '100%')).map((c) => c.id)).toEqual([a.id]);
    expect((await repo.listConversations(db, '_')).map((c) => c.id)).toEqual([b.id]);
  });

  it('ignores blank queries', async () => {
    await repo.createConversation(db, DEFAULT_SETTINGS);
    expect(await repo.listConversations(db, '   ')).toHaveLength(1);
  });
});
