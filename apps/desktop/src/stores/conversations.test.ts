import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../lib/sqlite-test-db';
import * as repo from '../lib/repo';
import { DEFAULT_SETTINGS, DEFAULT_TITLE } from '../lib/types';
import { createConversationsStore, selectActiveSettings, titleFrom } from './conversations';

let db: ReturnType<typeof createTestDb>;
let store: ReturnType<typeof createConversationsStore>;

beforeEach(() => {
  db = createTestDb();
  store = createConversationsStore(() => Promise.resolve(db));
});

describe('titleFrom', () => {
  it('uses the first non-empty line, trimmed and shortened', () => {
    expect(titleFrom('\n  hello world \nsecond')).toBe('hello world');
    expect(titleFrom('x'.repeat(100))).toHaveLength(60);
    expect(titleFrom('   ')).toBe(DEFAULT_TITLE);
  });
});

describe('conversations store', () => {
  it('starts as an empty draft and creates a row only on first use', async () => {
    await store.getState().load();
    expect(store.getState()).toMatchObject({ conversations: [], activeId: null, loaded: true });
    const created = await store.getState().ensureActive();
    expect(store.getState().activeId).toBe(created.id);
    expect(store.getState().conversations.map((c) => c.id)).toEqual([created.id]);
    // Calling it again reuses the same conversation.
    expect((await store.getState().ensureActive()).id).toBe(created.id);
  });

  it('applies draft settings to the conversation it creates', async () => {
    await store.getState().updateSettings({ model: 'opus', systemPrompt: 'terse' });
    const created = await store.getState().ensureActive();
    expect(created).toMatchObject({ model: 'opus', systemPrompt: 'terse', toolsMode: 'off' });
  });

  it('updates settings of the active conversation in the database', async () => {
    const c = await store.getState().ensureActive();
    await store.getState().updateSettings({ toolsMode: 'readonly', cwd: '/repo' });
    expect(await repo.getConversation(db, c.id)).toMatchObject({
      toolsMode: 'readonly',
      cwd: '/repo',
    });
    expect(selectActiveSettings(store.getState())).toMatchObject({
      toolsMode: 'readonly',
      cwd: '/repo',
    });
  });

  it('renames, ignoring blank titles', async () => {
    const c = await store.getState().ensureActive();
    await store.getState().rename(c.id, '  Better name ');
    await store.getState().rename(c.id, '   ');
    expect(store.getState().conversations[0]?.title).toBe('Better name');
  });

  it('auto-titles only conversations that still have the default title', async () => {
    const c = await store.getState().ensureActive();
    await store.getState().autoTitle(c.id, 'First message');
    await store.getState().autoTitle(c.id, 'Second message');
    expect(store.getState().conversations[0]?.title).toBe('First message');
    await store.getState().rename(c.id, 'Mine');
    await store.getState().autoTitle(c.id, 'Third');
    expect(store.getState().conversations[0]?.title).toBe('Mine');
  });

  it('pins to the top and unpins', async () => {
    const a = await repo.createConversation(db, DEFAULT_SETTINGS, 1);
    const b = await repo.createConversation(db, DEFAULT_SETTINGS, 2);
    await store.getState().load();
    expect(store.getState().conversations.map((c) => c.id)).toEqual([b.id, a.id]);
    await store.getState().togglePin(a.id);
    expect(store.getState().conversations.map((c) => [c.id, c.pinned])).toEqual([
      [a.id, true],
      [b.id, false],
    ]);
    await store.getState().togglePin(a.id);
    expect(store.getState().conversations[0]?.id).toBe(b.id);
  });

  it('deleting the active conversation returns to a fresh draft', async () => {
    const c = await store.getState().ensureActive();
    await store.getState().remove(c.id);
    expect(store.getState()).toMatchObject({ conversations: [], activeId: null });
  });

  it('searches titles and message content, then clears', async () => {
    const a = await repo.createConversation(db, DEFAULT_SETTINGS, 1);
    const b = await repo.createConversation(db, DEFAULT_SETTINGS, 2);
    await repo.renameConversation(db, a.id, 'Docker networking');
    await repo.insertMessage(db, {
      id: 'm1',
      conversationId: b.id,
      role: 'user',
      content: 'how do I configure docker volumes',
      attachments: [],
      status: 'complete',
      error: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      createdAt: 3,
    });
    await store.getState().setSearch('docker');
    expect(
      store
        .getState()
        .conversations.map((c) => c.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    await store.getState().setSearch('networking');
    expect(store.getState().conversations.map((c) => c.id)).toEqual([a.id]);
    await store.getState().setSearch('');
    expect(store.getState().conversations).toHaveLength(2);
  });

  it('reports database failures instead of throwing', async () => {
    const broken = createConversationsStore(() => Promise.reject(new Error('db down')));
    await broken.getState().load();
    expect(broken.getState().error).toBe('db down');
  });
});
