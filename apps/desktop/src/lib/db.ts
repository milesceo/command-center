import { isTauri } from './tauri';

/** Must match the connection string registered in src-tauri/src/lib.rs. */
export const DB_URL = 'sqlite:programish.db';

/**
 * Opens the app database. The SQL plugin applies pending migrations on load,
 * so calling this once at startup is what creates/upgrades the schema.
 * Returns null outside Tauri (web preview has no SQLite).
 */
export async function openDatabase() {
  if (!isTauri()) return null;
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  return Database.load(DB_URL);
}
