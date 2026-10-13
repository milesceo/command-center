import type { UsageReportEvent, UsageWindow } from '@programish/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeClient } from '../lib/bridge';
import * as repo from '../lib/repo-usage';
import { createTestDb } from '../lib/sqlite-test-db';
import { createUsageStore } from './usage';

let db: ReturnType<typeof createTestDb>;
const NOW = new Date(2026, 9, 14, 12).getTime();

const window = (over: Partial<UsageWindow> = {}): UsageWindow => ({
  key: 'five_hour',
  label: '5-hour',
  utilization: 0.4,
  resetsAt: NOW + 3_600_000,
  ...over,
});
const report = (over: Partial<UsageReportEvent> = {}): UsageReportEvent => ({
  type: 'usage.report',
  id: 'u',
  available: true,
  subscriptionType: 'max',
  windows: [window()],
  extraUsage: null,
  ...over,
});
let seq = 0;
const entry = (over: Partial<repo.UsageEntry> = {}): repo.UsageEntry => ({
  id: `u${++seq}`,
  conversationId: 'c1',
  messageId: 'm1',
  createdAt: NOW,
  model: 'claude-sonnet-5-5',
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: 300,
  cacheCreationTokens: 40,
  costUsd: 0.01,
  ...over,
});

function make(answer: () => Promise<UsageReportEvent> = () => Promise.resolve(report())) {
  const usage = vi.fn(answer);
  const store = createUsageStore({
    database: () => Promise.resolve(db),
    client: () => ({ usage }) as unknown as BridgeClient,
    ensureConnected: () => Promise.resolve(),
    now: () => NOW,
  });
  return { store, usage };
}

beforeEach(() => {
  db = createTestDb();
});

describe('usage store', () => {
  it('loads totals, filled daily/weekly series, models and top conversations', async () => {
    await repo.recordUsage(db, [entry(), entry({ messageId: 'm2', model: 'claude-opus-5-5' })]);
    const { store } = make();
    await store.getState().load();
    const data = store.getState().data!;
    expect(data.totals).toMatchObject({ replies: 2, inputTokens: 20, outputTokens: 40 });
    expect(data.daily).toHaveLength(30);
    expect(data.daily.at(-1)).toMatchObject({ outputTokens: 40 });
    expect(data.weekly.at(-1)).toMatchObject({ outputTokens: 40 });
    expect(data.models.map((m) => m.model).sort()).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ]);
    expect(data.top[0]).toMatchObject({ conversationId: 'c1', replies: 2 });
  });

  it('changes the range and metric', async () => {
    const { store } = make();
    await store.getState().setRange(7);
    expect(store.getState().data?.daily).toHaveLength(7);
    store.getState().setMetric('cost');
    expect(store.getState().metric).toBe('cost');
  });

  it('refreshing the report stores the windows the SDK returned', async () => {
    const { store, usage } = make();
    await store.getState().refreshReport();
    expect(usage).toHaveBeenCalledOnce();
    expect(store.getState().report).toMatchObject({
      status: 'ready',
      available: true,
      subscriptionType: 'max',
    });
    expect(store.getState().data?.windows).toMatchObject([
      { key: 'five_hour', utilization: 0.4, source: 'report' },
    ]);
  });

  it('an unavailable report keeps what chats observed and says so', async () => {
    const { store } = make(() => Promise.resolve(report({ available: false, windows: [] })));
    await store.getState().noteWindows([window({ utilization: 0.9 })]);
    await store.getState().refreshReport();
    expect(store.getState().report).toMatchObject({ status: 'ready', available: false });
    expect(await repo.loadWindows(db)).toMatchObject([{ utilization: 0.9, source: 'chat' }]);
  });

  it('a failed report becomes an error state, not an exception', async () => {
    const { store } = make(() => Promise.reject(new Error('timed out')));
    await store.getState().refreshReport();
    expect(store.getState().report).toEqual({ status: 'error', message: 'timed out' });
  });

  it('keeps per-conversation totals for the chat header', async () => {
    await repo.recordUsage(db, [entry(), entry({ messageId: 'm2', conversationId: 'c2' })]);
    const { store } = make();
    await store.getState().refreshConversation('c1');
    expect(store.getState().conversationTotals['c1']).toMatchObject({
      replies: 1,
      outputTokens: 20,
    });
    expect(store.getState().conversationTotals['c2']).toBeUndefined();
  });
});
