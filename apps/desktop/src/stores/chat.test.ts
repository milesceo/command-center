import type { BridgeEvent, ChatRequest } from '@programish/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BridgeClient, ChatHandle } from '../lib/bridge';
import * as repo from '../lib/repo';
import { createTestDb } from '../lib/sqlite-test-db';
import { createChatStore } from './chat';
import { createConversationsStore } from './conversations';

type Req = Omit<ChatRequest, 'type' | 'id'>;

/** Controllable stand-in for the bridge: tests push events into the running chat. */
function fakeClient() {
  const runs: { request: Req; emit: (e: BridgeEvent) => void; cancelled: boolean; id: string }[] =
    [];
  const client = {
    chat(request: Req, onEvent: (e: BridgeEvent) => void): ChatHandle {
      const run = { request, emit: onEvent, cancelled: false, id: `req-${runs.length}` };
      runs.push(run);
      return { id: run.id, cancel: () => (run.cancelled = true), done: Promise.resolve() };
    },
  } as unknown as BridgeClient;
  return { client, runs, last: () => runs[runs.length - 1]! };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const db = createTestDb();
  const conversations = createConversationsStore(() => Promise.resolve(db));
  const fake = fakeClient();
  const chat = createChatStore({
    database: () => Promise.resolve(db),
    client: () => fake.client,
    ensureConnected: () => Promise.resolve(),
    conversations,
    schedule: (flush) => {
      queueMicrotask(flush);
      return () => {};
    },
  });
  return { db, conversations, fake, chat };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

const reply = async (text: string, extra: Partial<BridgeEvent> = {}) => {
  const run = t.fake.last();
  run.emit({ type: 'chat.text', id: run.id, text });
  await settle();
  run.emit({
    type: 'chat.done',
    id: run.id,
    status: 'completed',
    model: 'm',
    usage: { inputTokens: 5, outputTokens: 6 },
    ...extra,
  } as BridgeEvent);
  await settle();
};

describe('chat store: sending', () => {
  it('creates the conversation, titles it, streams and persists the reply', async () => {
    await t.chat.getState().send('How do I reverse a list in Rust?');
    const convoId = t.conversations.getState().activeId!;
    expect(t.conversations.getState().conversations[0]?.title).toBe(
      'How do I reverse a list in Rust?',
    );
    expect(t.chat.getState().streams[convoId]).toBeDefined();

    const run = t.fake.last();
    run.emit({ type: 'chat.text', id: run.id, text: 'Use ' });
    run.emit({ type: 'chat.text', id: run.id, text: '`.rev()`' });
    await settle();
    expect(t.chat.getState().streams[convoId]?.text).toBe('Use `.rev()`');

    run.emit({
      type: 'chat.done',
      id: run.id,
      status: 'completed',
      model: 'claude-x',
      usage: { inputTokens: 5, outputTokens: 6 },
    });
    await settle();
    expect(t.chat.getState().streams[convoId]).toBeUndefined();
    expect(t.chat.getState().messages.map((m) => [m.role, m.content, m.status])).toEqual([
      ['user', 'How do I reverse a list in Rust?', 'complete'],
      ['assistant', 'Use `.rev()`', 'complete'],
    ]);
    expect(await repo.listMessages(t.db, convoId)).toHaveLength(2);
    expect(t.chat.getState().messages[1]).toMatchObject({
      model: 'claude-x',
      inputTokens: 5,
      outputTokens: 6,
    });
  });

  it('sends the whole stored transcript plus the conversation settings', async () => {
    await t.conversations.getState().updateSettings({
      model: 'opus',
      systemPrompt: 'terse',
      toolsMode: 'readonly',
      cwd: '/repo',
    });
    await t.chat.getState().send('one', [{ name: 'a.ts', text: 'x' }]);
    await reply('two');
    await t.chat.getState().send('three');
    expect(t.fake.last().request).toEqual({
      messages: [
        { role: 'user', content: 'one', attachments: [{ name: 'a.ts', text: 'x' }] },
        { role: 'assistant', content: 'two' },
        { role: 'user', content: 'three' },
      ],
      tools: 'readonly',
      model: 'opus',
      systemPrompt: 'terse',
      cwd: '/repo',
    });
  });

  it('ignores empty input and a second send while streaming', async () => {
    await t.chat.getState().send('   ');
    expect(t.fake.runs).toHaveLength(0);
    await t.chat.getState().send('hello');
    await t.chat.getState().send('again');
    expect(t.fake.runs).toHaveLength(1);
    expect(t.chat.getState().messages).toHaveLength(1);
  });
});

describe('chat store: stop and errors', () => {
  it('stop cancels, keeps the partial reply as stopped, and chatting resumes', async () => {
    await t.chat.getState().send('write a long essay');
    const convoId = t.conversations.getState().activeId!;
    const run = t.fake.last();
    run.emit({ type: 'chat.text', id: run.id, text: 'Once upon' });
    await settle();
    t.chat.getState().stop(convoId);
    expect(run.cancelled).toBe(true);
    run.emit({ type: 'chat.done', id: run.id, status: 'cancelled' });
    await settle();

    expect(t.chat.getState().messages[1]).toMatchObject({
      content: 'Once upon',
      status: 'stopped',
    });

    await t.chat.getState().send('continue');
    expect(t.fake.last().request.messages.map((m) => m.content)).toEqual([
      'write a long essay',
      'Once upon',
      'continue',
    ]);
  });

  it('a stop with no text stores nothing', async () => {
    await t.chat.getState().send('hi');
    const run = t.fake.last();
    t.chat.getState().stop(t.conversations.getState().activeId!);
    run.emit({ type: 'chat.done', id: run.id, status: 'cancelled' });
    await settle();
    expect(t.chat.getState().messages).toHaveLength(1);
  });

  it('shows a banner for a failure with no reply text, and clears it on the next send', async () => {
    await t.chat.getState().send('hi');
    const convoId = t.conversations.getState().activeId!;
    const run = t.fake.last();
    run.emit({ type: 'error', id: run.id, error: { code: 'auth_required', message: 'm' } });
    await settle();
    expect(t.chat.getState().errors[convoId]).toMatchObject({ code: 'auth_required' });
    expect(t.chat.getState().messages).toHaveLength(1);

    await t.chat.getState().regenerate();
    expect(t.chat.getState().errors[convoId]).toBeNull();
    expect(t.fake.runs).toHaveLength(2);
  });

  it('keeps partial text with an error status when a failure interrupts the reply', async () => {
    await t.chat.getState().send('hi');
    const run = t.fake.last();
    run.emit({ type: 'chat.text', id: run.id, text: 'partial' });
    await settle();
    run.emit({
      type: 'error',
      id: run.id,
      error: { code: 'usage_limit', message: 'm', resetsAt: 123 },
    });
    await settle();
    expect(t.chat.getState().messages[1]).toMatchObject({
      content: 'partial',
      status: 'error',
      error: { code: 'usage_limit', resetsAt: 123 },
    });
  });

  it('records rate-limit warnings and tool activity on the live stream', async () => {
    await t.chat.getState().send('hi');
    const convoId = t.conversations.getState().activeId!;
    const run = t.fake.last();
    run.emit({
      type: 'chat.rate_limit',
      id: run.id,
      status: 'allowed_warning',
      limitType: 'five_hour',
      utilization: 0.9,
    });
    run.emit({ type: 'chat.tool_use', id: run.id, toolUseId: 't1', name: 'Read', summary: 'a.ts' });
    run.emit({ type: 'chat.tool_result', id: run.id, toolUseId: 't1', isError: false });
    const stream = t.chat.getState().streams[convoId]!;
    expect(stream.rateLimit).toMatchObject({ status: 'allowed_warning', utilization: 0.9 });
    expect(stream.tools).toEqual([
      { toolUseId: 't1', name: 'Read', summary: 'a.ts', status: 'done' },
    ]);
  });
});

describe('chat store: regenerate and edit', () => {
  it('regenerate replaces the last assistant reply', async () => {
    await t.chat.getState().send('q');
    await reply('first answer');
    await t.chat.getState().regenerate();
    expect(t.chat.getState().messages.map((m) => m.role)).toEqual(['user']);
    expect(t.fake.last().request.messages).toEqual([{ role: 'user', content: 'q' }]);
    await reply('second answer');
    expect(t.chat.getState().messages.map((m) => m.content)).toEqual(['q', 'second answer']);
    const convoId = t.conversations.getState().activeId!;
    expect((await repo.listMessages(t.db, convoId)).map((m) => m.content)).toEqual([
      'q',
      'second answer',
    ]);
  });

  it('edit and resend rewinds history from the edited message', async () => {
    await t.chat.getState().send('original');
    await reply('a1');
    await t.chat.getState().send('follow up');
    await reply('a2');
    const first = t.chat.getState().messages[0]!;
    await t.chat.getState().editAndResend(first.id, 'rewritten');
    expect(t.chat.getState().messages.map((m) => m.content)).toEqual(['rewritten']);
    expect(t.fake.last().request.messages).toEqual([{ role: 'user', content: 'rewritten' }]);
    await reply('a3');
    const convoId = t.conversations.getState().activeId!;
    expect((await repo.listMessages(t.db, convoId)).map((m) => m.content)).toEqual([
      'rewritten',
      'a3',
    ]);
  });

  it('edit keeps attachments and refuses to edit while streaming or edit assistant messages', async () => {
    await t.chat.getState().send('x', [{ name: 'f.txt', text: 'body' }]);
    const user = t.chat.getState().messages[0]!;
    await t.chat.getState().editAndResend(user.id, 'y'); // still streaming: ignored
    expect(t.fake.runs).toHaveLength(1);
    await reply('ok');
    const assistant = t.chat.getState().messages[1]!;
    await t.chat.getState().editAndResend(assistant.id, 'nope');
    expect(t.fake.runs).toHaveLength(1);
    await t.chat.getState().editAndResend(user.id, 'y');
    expect(t.fake.last().request.messages[0]).toEqual({
      role: 'user',
      content: 'y',
      attachments: [{ name: 'f.txt', text: 'body' }],
    });
  });
});

describe('chat store: persistence and isolation', () => {
  it('a fresh store over the same database sees the conversation (survives restart)', async () => {
    await t.chat.getState().send('remember me');
    await reply('noted');
    const convoId = t.conversations.getState().activeId!;

    const restarted = createConversationsStore(() => Promise.resolve(t.db));
    await restarted.getState().load();
    expect(restarted.getState().conversations.map((c) => c.id)).toEqual([convoId]);
    restarted.getState().select(convoId);
    const chat2 = createChatStore({
      database: () => Promise.resolve(t.db),
      client: () => t.fake.client,
      ensureConnected: () => Promise.resolve(),
      conversations: restarted,
    });
    await chat2.getState().loadMessages(convoId);
    expect(chat2.getState().messages.map((m) => m.content)).toEqual(['remember me', 'noted']);
  });

  it('streams in two conversations independently', async () => {
    await t.chat.getState().send('first convo');
    const first = t.conversations.getState().activeId!;
    const run1 = t.fake.last();
    t.conversations.getState().newChat();
    await t.chat.getState().loadMessages(null);
    await t.chat.getState().send('second convo');
    const second = t.conversations.getState().activeId!;
    expect(second).not.toBe(first);
    expect(Object.keys(t.chat.getState().streams).sort()).toEqual([first, second].sort());

    run1.emit({ type: 'chat.text', id: run1.id, text: 'late reply' });
    run1.emit({ type: 'chat.done', id: run1.id, status: 'completed' });
    await settle();
    // The first conversation's reply is stored even though it is not on screen.
    expect((await repo.listMessages(t.db, first)).map((m) => m.content)).toEqual([
      'first convo',
      'late reply',
    ]);
    expect(t.chat.getState().messages.map((m) => m.content)).toEqual(['second convo']);
  });

  it('loadMessages does not clobber messages appended by send', async () => {
    const c = await t.conversations.getState().ensureActive();
    const pending = t.chat.getState().loadMessages(c.id);
    await t.chat.getState().send('hello');
    await pending;
    expect(t.chat.getState().messages.map((m) => m.content)).toEqual(['hello']);
  });
});
