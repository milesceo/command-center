import type { UsageWindow } from '@geeked/protocol';
import type { Db } from './db';

/**
 * The usage ledger and its aggregations. Tokens are recorded exactly as the SDK
 * reported them; nothing here estimates. Cost is the SDK's API-equivalent price,
 * which is informational on a subscription, and stays null when not reported.
 */

export interface UsageEntry {
  id: string;
  createdAt: number;
  conversationId: string | null;
  messageId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number | null;
}

export async function recordUsage(db: Db, entries: UsageEntry[]): Promise<void> {
  for (const e of entries) {
    await db.execute(
      `INSERT INTO usage_log
         (id, created_at, conversation_id, message_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.id,
        e.createdAt,
        e.conversationId,
        e.messageId,
        e.model,
        e.inputTokens,
        e.outputTokens,
        e.cacheReadTokens,
        e.cacheCreationTokens,
        e.costUsd,
      ],
    );
  }
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Sum of the costs the SDK reported; null when it reported none. */
  costUsd: number | null;
  /** False when some rows had no reported cost, so `costUsd` is a lower bound. */
  costComplete: boolean;
  replies: number;
}

export const EMPTY_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: null,
  costComplete: true,
  replies: 0,
};

/** Column sums for a usage_log query; `p` is the table alias prefix (e.g. `u.`) when joined. */
const sums = (p = '') => `
  COALESCE(SUM(${p}input_tokens), 0)           AS input_tokens,
  COALESCE(SUM(${p}output_tokens), 0)          AS output_tokens,
  COALESCE(SUM(${p}cache_read_tokens), 0)      AS cache_read_tokens,
  COALESCE(SUM(${p}cache_creation_tokens), 0)  AS cache_creation_tokens,
  SUM(${p}cost_usd)                            AS cost_usd,
  COUNT(${p}cost_usd)                          AS cost_rows,
  COUNT(*)                                     AS rows,
  COUNT(DISTINCT COALESCE(${p}message_id, ${p}id)) AS replies`;
const SUMS = sums();

interface SumRow {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number | null;
  cost_rows: number;
  rows: number;
  replies: number;
}

function toTotals(row: SumRow): UsageTotals {
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    costUsd: row.cost_rows > 0 ? row.cost_usd : null,
    // With no reported cost at all the figure is null, so completeness does not matter.
    costComplete: row.cost_rows === 0 || row.cost_rows === row.rows,
    replies: row.replies,
  };
}

/** Every token in the total, cached or not. */
export const totalTokens = (
  t: Pick<UsageTotals, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheCreationTokens'>,
) => t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens;

export async function conversationTotals(db: Db, conversationId: string): Promise<UsageTotals> {
  const rows = await db.select<SumRow>(`SELECT ${SUMS} FROM usage_log WHERE conversation_id = ?`, [
    conversationId,
  ]);
  return rows[0] ? toTotals(rows[0]) : EMPTY_TOTALS;
}

export async function usageTotals(db: Db, sinceMs: number): Promise<UsageTotals> {
  const rows = await db.select<SumRow>(`SELECT ${SUMS} FROM usage_log WHERE created_at >= ?`, [
    sinceMs,
  ]);
  return rows[0] ? toTotals(rows[0]) : EMPTY_TOTALS;
}

export interface BucketRow extends UsageTotals {
  /** Local calendar day (YYYY-MM-DD) or, for weeks, the Monday that starts the week. */
  bucket: string;
}

async function byBucket(db: Db, bucketSql: string, sinceMs: number): Promise<BucketRow[]> {
  const rows = await db.select<SumRow & { bucket: string }>(
    `SELECT ${bucketSql} AS bucket, ${SUMS} FROM usage_log WHERE created_at >= ? GROUP BY bucket ORDER BY bucket`,
    [sinceMs],
  );
  return rows.map((r) => ({ bucket: r.bucket, ...toTotals(r) }));
}

const DAY = "date(created_at / 1000, 'unixepoch', 'localtime')";
// 'weekday 0' moves to the Sunday that ends the week; minus six days is that week's Monday.
const WEEK = "date(created_at / 1000, 'unixepoch', 'localtime', 'weekday 0', '-6 days')";

export const usageByDay = (db: Db, sinceMs: number) => byBucket(db, DAY, sinceMs);
export const usageByWeek = (db: Db, sinceMs: number) => byBucket(db, WEEK, sinceMs);

export interface ModelRow extends UsageTotals {
  model: string;
}

export async function usageByModel(db: Db, sinceMs: number): Promise<ModelRow[]> {
  const rows = await db.select<SumRow & { model: string }>(
    `SELECT model, ${SUMS} FROM usage_log WHERE created_at >= ? GROUP BY model`,
    [sinceMs],
  );
  return rows
    .map((r) => ({ model: r.model, ...toTotals(r) }))
    .sort((a, b) => totalTokens(b) - totalTokens(a) || a.model.localeCompare(b.model));
}

export interface ConversationUsageRow extends UsageTotals {
  conversationId: string | null;
  /** Null when the conversation has since been deleted. */
  title: string | null;
}

export async function topConversations(
  db: Db,
  sinceMs: number,
  limit = 10,
): Promise<ConversationUsageRow[]> {
  const rows = await db.select<SumRow & { conversation_id: string | null; title: string | null }>(
    `SELECT u.conversation_id AS conversation_id, c.title AS title, ${sums('u.')}
       FROM usage_log u LEFT JOIN conversations c ON c.id = u.conversation_id
      WHERE u.created_at >= ?
      GROUP BY u.conversation_id`,
    [sinceMs],
  );
  return rows
    .map((r) => ({ conversationId: r.conversation_id, title: r.title, ...toTotals(r) }))
    .sort((a, b) => totalTokens(b) - totalTokens(a))
    .slice(0, limit);
}

// ------------------------------------------------------------ plan windows

export interface StoredWindow extends UsageWindow {
  observedAt: number;
  source: 'chat' | 'report';
}

export async function saveWindows(
  db: Db,
  windows: UsageWindow[],
  source: 'chat' | 'report',
  observedAt = Date.now(),
): Promise<void> {
  for (const w of windows) {
    await db.execute(
      `INSERT INTO usage_windows (key, label, utilization, resets_at, observed_at, source) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET label = excluded.label, utilization = excluded.utilization,
         resets_at = excluded.resets_at, observed_at = excluded.observed_at, source = excluded.source`,
      [w.key, w.label, w.utilization, w.resetsAt, observedAt, source],
    );
  }
}

/** A full report replaces the previous reading, dropping windows the plan no longer has. */
export async function replaceWindows(
  db: Db,
  windows: UsageWindow[],
  observedAt = Date.now(),
): Promise<void> {
  await db.execute("DELETE FROM usage_windows WHERE source = 'report'");
  await saveWindows(db, windows, 'report', observedAt);
}

export async function loadWindows(db: Db): Promise<StoredWindow[]> {
  const rows = await db.select<{
    key: string;
    label: string;
    utilization: number | null;
    resets_at: number | null;
    observed_at: number;
    source: 'chat' | 'report';
  }>('SELECT * FROM usage_windows ORDER BY key');
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    utilization: r.utilization,
    resetsAt: r.resets_at,
    observedAt: r.observed_at,
    source: r.source,
  }));
}
