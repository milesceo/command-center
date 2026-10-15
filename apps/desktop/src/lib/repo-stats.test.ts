import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './types';
import * as repo from './repo';
import { launchStats, startOfDay } from './repo-stats';
import { createTestDb } from './sqlite-test-db';

describe('launchStats', () => {
  it('counts chats created yesterday, today and in total, in local calendar days', async () => {
    const db = createTestDb();
    const now = new Date(2026, 9, 14, 10, 0, 0);
    const today = startOfDay(now);
    const day = 24 * 60 * 60 * 1000;

    await repo.createConversation(db, DEFAULT_SETTINGS, today + 60_000); // today
    await repo.createConversation(db, DEFAULT_SETTINGS, today - 60_000); // yesterday, late
    await repo.createConversation(db, DEFAULT_SETTINGS, today - day + 60_000); // yesterday, early
    await repo.createConversation(db, DEFAULT_SETTINGS, today - 3 * day); // older

    const stats = await launchStats(db, now);
    expect(stats).toEqual({
      chatsToday: 1,
      chatsYesterday: 2,
      chatsTotal: 4,
      messagesTotal: 0,
    });
  });

  it('is all zeros on an empty database', async () => {
    const stats = await launchStats(createTestDb(), new Date());
    expect(stats).toEqual({ chatsYesterday: 0, chatsToday: 0, chatsTotal: 0, messagesTotal: 0 });
  });
});
