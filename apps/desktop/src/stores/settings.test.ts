// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '../lib/repo';
import { createTestDb } from '../lib/sqlite-test-db';
import { createConversationsStore } from './conversations';
import { applyDisplaySettings, freshDraft, useSettings } from './settings';

beforeEach(() => {
  useSettings.getState().reset();
  document.documentElement.removeAttribute('style');
});

describe('settings', () => {
  it('new chats start from the chosen model and system prompt', async () => {
    useSettings.getState().setDefaultModel('opus');
    useSettings.getState().setDefaultSystemPrompt('Be brief.');
    expect(freshDraft()).toMatchObject({
      model: 'opus',
      systemPrompt: 'Be brief.',
      toolsMode: 'off',
    });

    const store = createConversationsStore(() => Promise.resolve(createTestDb()));
    store.getState().newChat();
    expect(store.getState().draft).toMatchObject({ model: 'opus', systemPrompt: 'Be brief.' });
    const chat = await store.getState().ensureActive();
    expect(chat).toMatchObject({ model: 'opus', systemPrompt: 'Be brief.' });
  });

  it('a blank default prompt means none, and existing chats keep their own values', async () => {
    useSettings.getState().setDefaultSystemPrompt('   ');
    expect(freshDraft().systemPrompt).toBeNull();
    const db = createTestDb();
    const store = createConversationsStore(() => Promise.resolve(db));
    const chat = await store.getState().ensureActive();
    useSettings.getState().setDefaultModel('haiku');
    expect((await repo.getConversation(db, chat.id))?.model).toBeNull();
  });

  it('applies zoom and the code font size to the document', () => {
    applyDisplaySettings(125, 14);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('zoom')).toBe('1.25');
    expect(root.style.getPropertyValue('--code-font-size')).toBe('14px');
    applyDisplaySettings(100, 12.5);
    expect(root.style.getPropertyValue('zoom')).toBe('');
  });

  it('reset restores the defaults', () => {
    useSettings.getState().setUiScale(125);
    useSettings.getState().setCodeFontSize(15);
    useSettings.getState().reset();
    expect(useSettings.getState()).toMatchObject({
      uiScale: 100,
      codeFontSize: 12.5,
      defaultModel: null,
    });
  });
});
