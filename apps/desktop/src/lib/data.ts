import type { Db } from './db';

/** Every table the app owns, in an order that is safe to delete in (children first). */
const TABLES = [
  'messages',
  'conversations',
  'usage_log',
  'usage_windows',
  'prompts',
  'projects',
  'custom_models',
  'business_plans',
] as const;
export type Table = (typeof TABLES)[number];

export const EXPORT_FORMAT = 'command-center-data';
export const EXPORT_VERSION = 1;

export interface DataExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  tables: Record<Table, Record<string, unknown>[]>;
}

/** All rows of every table, as plain JSON. Message content is included: treat the file like the chats themselves. */
export async function exportAll(db: Db, now = new Date()): Promise<DataExport> {
  const tables = {} as DataExport['tables'];
  for (const table of TABLES) {
    // Table names come from the constant list above, never from input.
    tables[table] = await db.select<Record<string, unknown>>(`SELECT * FROM ${table}`);
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), tables };
}

export type ClearScope = 'usage' | 'prompts' | 'everything';

const SCOPES: Record<ClearScope, readonly Table[]> = {
  usage: ['usage_log', 'usage_windows'],
  prompts: ['prompts', 'projects'],
  everything: TABLES,
};

/**
 * Deletes rows for good. Conversations referencing a deleted project or prompt keep
 * working: they simply lose that reference.
 */
export async function clearData(db: Db, scope: ClearScope): Promise<void> {
  if (scope === 'prompts') {
    await db.execute('UPDATE conversations SET project_id = NULL, system_prompt_id = NULL');
  }
  for (const table of SCOPES[scope]) await db.execute(`DELETE FROM ${table}`);
}

export interface DataCounts {
  conversations: number;
  messages: number;
  prompts: number;
  projects: number;
  plans: number;
  usageRows: number;
}

export async function countData(db: Db): Promise<DataCounts> {
  const count = async (table: Table) =>
    (await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n ?? 0;
  return {
    conversations: await count('conversations'),
    messages: await count('messages'),
    prompts: await count('prompts'),
    projects: await count('projects'),
    plans: await count('business_plans'),
    usageRows: await count('usage_log'),
  };
}
