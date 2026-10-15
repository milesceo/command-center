import type { Db } from './db';
import type { LaunchStats } from './launch-messages';

/** Midnight (local time) at the start of `now`'s day, as epoch ms. */
export function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const rows = await db.select<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/**
 * The few numbers the landing screen's "stat" messages can use. "Yesterday" and "today" are
 * calendar days in local time, based on when a chat was created.
 */
export async function launchStats(db: Db, now = new Date()): Promise<LaunchStats> {
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const startYesterday = yesterday.getTime();

  const [chatsYesterday, chatsToday, chatsTotal, messagesTotal] = await Promise.all([
    count(db, 'SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ? AND created_at < ?', [
      startYesterday,
      today,
    ]),
    count(db, 'SELECT COUNT(*) AS n FROM conversations WHERE created_at >= ?', [today]),
    count(db, 'SELECT COUNT(*) AS n FROM conversations'),
    count(db, 'SELECT COUNT(*) AS n FROM messages'),
  ]);
  return { chatsYesterday, chatsToday, chatsTotal, messagesTotal };
}
