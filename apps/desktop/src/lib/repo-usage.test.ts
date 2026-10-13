import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import * as repo from './repo';
import * as usage from './repo-usage';
import { createTestDb } from './sqlite-test-db';
import { message, settings } from './test-fixtures';
import { dayKey, fillDays, fillWeeks } from './usage-series';

let db: Db;
beforeEach(() => {
  db = createTestDb();
});

let n = 0;
const entry = (over: Partial<usage.UsageEntry> = {}): usage.UsageEntry => ({
  id: `u${++n}`,
  createdAt: new Date(2026, 9, 14, 12).getTime(),
  conversationId: 'c1',
  messageId: `m${n}`,
  model: 'claude-haiku-5-5',
  inputTokens: 2,
  outputTokens: 4,
  cacheReadTokens: 0,
  cacheCreationTokens: 1225,
  costUsd: 0.0002472,
  ...over,
});
const day = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
const EPOCH = 0;

describe('recording and totals', () => {
  it('stores exactly the numbers it is given (the SDK result for a one-word haiku reply)', async () => {
    await usage.recordUsage(db, [entry()]);
    const totals = await usage.usageTotals(db, EPOCH);
    expect(totals).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheCreationTokens: 1225,
      costUsd: 0.0002472,
      costComplete: true,
      replies: 1,
    });
    expect(usage.totalTokens(totals)).toBe(1231);
  });

  it('sums several replies and counts a reply once however many models it used', async () => {
    await usage.recordUsage(db, [
      entry({ messageId: 'a', model: 'm1', inputTokens: 10, outputTokens: 5, costUsd: 0.01 }),
      entry({ messageId: 'a', model: 'm2', inputTokens: 1, outputTokens: 1, costUsd: 0.02 }),
      entry({ messageId: 'b', model: 'm1', inputTokens: 100, outputTokens: 50, costUsd: 0.1 }),
    ]);
    const totals = await usage.usageTotals(db, EPOCH);
    expect(totals).toMatchObject({ inputTokens: 111, outputTokens: 56, replies: 2 });
    expect(totals.costUsd).toBeCloseTo(0.13, 10);
  });

  it('keeps cost null when the SDK reported none, and flags partial cost', async () => {
    await usage.recordUsage(db, [entry({ costUsd: null })]);
    expect(await usage.usageTotals(db, EPOCH)).toMatchObject({ costUsd: null, costComplete: true });
    await usage.recordUsage(db, [entry({ costUsd: 0.5 })]);
    expect(await usage.usageTotals(db, EPOCH)).toMatchObject({ costUsd: 0.5, costComplete: false });
  });

  it('is empty, not an error, with no usage', async () => {
    expect(await usage.usageTotals(db, EPOCH)).toEqual(usage.EMPTY_TOTALS);
    expect(await usage.conversationTotals(db, 'nope')).toEqual(usage.EMPTY_TOTALS);
  });

  it('keeps counting tokens after the reply is regenerated or the conversation is deleted', async () => {
    const c = await repo.createConversation(db, settings());
    const m = message({ conversationId: c.id, role: 'assistant' });
    await repo.insertMessage(db, m);
    await usage.recordUsage(db, [
      entry({ conversationId: c.id, messageId: m.id, outputTokens: 40 }),
    ]);
    await repo.deleteMessagesFrom(db, c.id, m.id);
    await repo.deleteConversation(db, c.id);
    expect(await usage.usageTotals(db, EPOCH)).toMatchObject({ outputTokens: 40, replies: 1 });
  });
});

describe('per-conversation totals', () => {
  it('only counts that conversation', async () => {
    await usage.recordUsage(db, [
      entry({ conversationId: 'a', outputTokens: 1 }),
      entry({ conversationId: 'b', outputTokens: 10 }),
      entry({ conversationId: 'a', outputTokens: 2 }),
    ]);
    expect(await usage.conversationTotals(db, 'a')).toMatchObject({ outputTokens: 3, replies: 2 });
  });
});

describe('daily and weekly buckets', () => {
  it('groups by local calendar day (late evening stays on its own day) and respects the range', async () => {
    await usage.recordUsage(db, [
      entry({ createdAt: day(12, 0), outputTokens: 1 }),
      entry({ createdAt: day(12, 23), outputTokens: 2 }),
      entry({ createdAt: day(14, 9), outputTokens: 4 }),
      entry({ createdAt: day(1), outputTokens: 99 }),
    ]);
    const rows = await usage.usageByDay(db, day(10));
    expect(rows.map((r) => [r.bucket, r.outputTokens])).toEqual([
      ['2026-10-12', 3],
      ['2026-10-14', 4],
    ]);
    const series = fillDays(rows, 3, new Date(2026, 9, 14, 20));
    expect(series.map((p) => [p.bucket, p.outputTokens])).toEqual([
      ['2026-10-12', 3],
      ['2026-10-13', 0],
      ['2026-10-14', 4],
    ]);
  });

  it('groups weeks from Monday to Sunday', async () => {
    await usage.recordUsage(db, [
      entry({ createdAt: day(12), outputTokens: 1 }), // Monday
      entry({ createdAt: day(18, 22), outputTokens: 2 }), // Sunday, same week
      entry({ createdAt: day(19), outputTokens: 4 }), // next Monday
      entry({ createdAt: day(5), outputTokens: 8 }), // previous Monday
    ]);
    const rows = await usage.usageByWeek(db, day(1));
    expect(rows.map((r) => [r.bucket, r.outputTokens])).toEqual([
      ['2026-10-05', 8],
      ['2026-10-12', 3],
      ['2026-10-19', 4],
    ]);
    expect(fillWeeks(rows, 4, new Date(2026, 9, 21)).map((p) => p.bucket)).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
    expect(dayKey(new Date(day(12)))).toBe('2026-10-12');
  });
});

describe('breakdowns', () => {
  it('ranks models by total tokens', async () => {
    await usage.recordUsage(db, [
      entry({ model: 'small', outputTokens: 10, cacheCreationTokens: 0 }),
      entry({ model: 'big', outputTokens: 1000, cacheCreationTokens: 0 }),
      entry({ model: 'big', outputTokens: 1, cacheCreationTokens: 0 }),
    ]);
    const models = await usage.usageByModel(db, EPOCH);
    expect(models.map((m) => [m.model, m.outputTokens])).toEqual([
      ['big', 1001],
      ['small', 10],
    ]);
  });

  it('ranks conversations, naming them while they exist and marking deleted ones', async () => {
    const kept = await repo.createConversation(db, settings());
    await repo.renameConversation(db, kept.id, 'Kept chat');
    await usage.recordUsage(db, [
      entry({ conversationId: kept.id, outputTokens: 50, cacheCreationTokens: 0 }),
      entry({ conversationId: 'deleted-one', outputTokens: 500, cacheCreationTokens: 0 }),
      entry({ conversationId: kept.id, outputTokens: 5, cacheCreationTokens: 0 }),
    ]);
    const top = await usage.topConversations(db, EPOCH, 5);
    expect(top.map((t) => [t.conversationId, t.title, t.outputTokens])).toEqual([
      ['deleted-one', null, 500],
      [kept.id, 'Kept chat', 55],
    ]);
    expect((await usage.topConversations(db, EPOCH, 1)).length).toBe(1);
  });
});

describe('plan windows', () => {
  const w = (key: string, utilization: number | null, resetsAt: number | null = 5) => ({
    key,
    label: key,
    utilization,
    resetsAt,
  });

  it('keeps the latest reading per window', async () => {
    await usage.saveWindows(db, [w('five_hour', 0.1), w('seven_day', 0.2)], 'chat', 100);
    await usage.saveWindows(db, [w('five_hour', 0.3)], 'chat', 200);
    const stored = await usage.loadWindows(db);
    expect(stored).toEqual([
      {
        key: 'five_hour',
        label: 'five_hour',
        utilization: 0.3,
        resetsAt: 5,
        observedAt: 200,
        source: 'chat',
      },
      {
        key: 'seven_day',
        label: 'seven_day',
        utilization: 0.2,
        resetsAt: 5,
        observedAt: 100,
        source: 'chat',
      },
    ]);
  });

  it('a full report replaces earlier reports but not what chats observed', async () => {
    await usage.replaceWindows(db, [w('five_hour', 0.5), w('model:Opus', 0.9)], 100);
    await usage.replaceWindows(db, [w('five_hour', 0.6)], 200);
    expect((await usage.loadWindows(db)).map((x) => [x.key, x.utilization])).toEqual([
      ['five_hour', 0.6],
    ]);
  });

  it('stores unknown utilization as null', async () => {
    await usage.saveWindows(db, [w('five_hour', null, null)], 'report', 1);
    expect(await usage.loadWindows(db)).toMatchObject([{ utilization: null, resetsAt: null }]);
  });
});
