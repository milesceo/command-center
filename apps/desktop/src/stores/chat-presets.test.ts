import type { BridgeEvent, ChatRequest } from '@command-center/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeClient, ChatHandle } from '../lib/bridge';
import type { Db } from '../lib/db';
import * as repo from '../lib/repo';
import { createCustomModel } from '../lib/repo-models';
import { createTestDb } from '../lib/sqlite-test-db';
import { DEFAULT_SETTINGS } from '../lib/types';

// Model Lab models are read through the shared database handle.
const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));

import { createChatStore } from './chat';
import { createConversationsStore } from './conversations';
import { customModelRef } from './custom-models';
import { createUsageStore } from './usage';

type Req = Omit<ChatRequest, 'type' | 'id'>;

function setup() {
  hoisted.db = createTestDb();
  const requests: Req[] = [];
  const client = {
    chat(request: Req, _onEvent: (e: BridgeEvent) => void): ChatHandle {
      requests.push(request);
      return { id: 'r', cancel: () => {}, done: Promise.resolve() };
    },
  } as unknown as BridgeClient;
  const database = () => Promise.resolve(hoisted.db);
  const conversations = createConversationsStore(database);
  const usage = createUsageStore({
    database,
    client: () => client,
    ensureConnected: () => Promise.resolve(),
  });
  const chat = createChatStore({
    database,
    client: () => client,
    ensureConnected: () => Promise.resolve(),
    usage,
    conversations,
    schedule: (flush) => {
      queueMicrotask(flush);
      return () => {};
    },
  });
  return { conversations, chat, requests };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

const local = {
  provider: 'local' as const,
  model: 'qwen2.5:0.5b',
  displayName: 'Tiny',
  hfRepo: null,
  runtime: 'ollama' as const,
  baseUrl: 'http://127.0.0.1:11434/v1',
  quant: null,
  filePath: null,
  adapterPath: null,
  systemPrompt: 'Be brief.',
  params: { temperature: 0.2, topK: 40 },
  tags: [],
};

describe('per-chat presets', () => {
  it('stores a chat override and reads it back; empty becomes null', async () => {
    const c = await repo.createConversation(hoisted.db, {
      ...DEFAULT_SETTINGS,
      modelParams: { temperature: 1.1 },
    });
    expect((await repo.getConversation(hoisted.db, c.id))?.modelParams).toEqual({
      temperature: 1.1,
    });
    await repo.updateSettings(hoisted.db, c.id, { ...DEFAULT_SETTINGS, modelParams: {} });
    expect((await repo.getConversation(hoisted.db, c.id))?.modelParams).toBeNull();
  });

  it("merges the chat's overrides over the model's presets, key by key", async () => {
    const m = await createCustomModel(hoisted.db, local);
    await t.conversations.getState().updateSettings({
      provider: 'local',
      model: customModelRef(m.id),
      modelParams: { temperature: 0.9, maxTokens: 50 },
    });
    await t.chat.getState().send('Hi');
    expect(t.requests[0]).toMatchObject({
      provider: 'local',
      model: 'qwen2.5:0.5b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      systemPrompt: 'Be brief.',
      params: { temperature: 0.9, topK: 40, maxTokens: 50 },
    });
  });

  it("uses the model's presets unchanged without an override", async () => {
    const m = await createCustomModel(hoisted.db, local);
    await t.conversations
      .getState()
      .updateSettings({ provider: 'local', model: customModelRef(m.id) });
    await t.chat.getState().send('Hi');
    expect(t.requests[0]?.params).toEqual({ temperature: 0.2, topK: 40 });
  });
});
