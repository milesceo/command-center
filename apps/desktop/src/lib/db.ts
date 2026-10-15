import { isTauri } from './tauri';

/** Must match the connection string registered in src-tauri/src/lib.rs. */
export const DB_URL = 'sqlite:geeked.db';

/** The subset of the SQL plugin's Database that the app uses (also implemented over node:sqlite in tests). */
export interface Db {
  /** Written with `?` placeholders, bound positionally; the Tauri adapter renumbers them for the plugin. */
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
}

let opening: Promise<Db> | undefined;

/**
 * Opens the app database once. The SQL plugin applies pending migrations on
 * load, so the first call is what creates/upgrades the schema.
 */
export function getDb(): Promise<Db> {
  opening ??= open();
  return opening;
}

/**
 * The SQL plugin documents `$1, $2, ...` placeholders for SQLite, so repo code
 * (written with portable `?`) is renumbered here. Quoted strings are skipped so
 * a literal `?` inside a string is never touched.
 */
export function toNumberedParams(sql: string): string {
  let n = 0;
  let quote: string | null = null;
  let out = '';
  for (const ch of sql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === '?') {
      out += `$${++n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

async function open(): Promise<Db> {
  if (!isTauri()) throw new Error('The database is only available in the desktop app.');
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  const database = await Database.load(DB_URL);
  return {
    select: (sql, params) => database.select(toNumberedParams(sql), params ?? []),
    execute: async (sql, params) => {
      const { rowsAffected } = await database.execute(toNumberedParams(sql), params ?? []);
      return { rowsAffected };
    },
  };
}
