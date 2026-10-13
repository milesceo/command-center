import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import type { Db } from './db';

// Loaded at runtime rather than imported: Vite refuses to bundle node:sqlite
// for the jsdom (browser-like) test environment.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

// Vitest runs with the package root as cwd (apps/desktop).
const MIGRATIONS_DIR = join(process.cwd(), 'src-tauri', 'migrations');

/**
 * In-memory SQLite with every real migration applied, exposed through the
 * same interface as the Tauri SQL plugin. Tests only (imports node:sqlite).
 */
export function createTestDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));

  return {
    select<T>(sql: string, params: unknown[] = []) {
      return Promise.resolve(sqlite.prepare(sql).all(...(params as SQLInputValue[])) as T[]);
    },
    execute(sql: string, params: unknown[] = []) {
      const result = sqlite.prepare(sql).run(...(params as SQLInputValue[]));
      return Promise.resolve({ rowsAffected: Number(result.changes) });
    },
  };
}
