import { isTauri } from './tauri';

export interface DataLocation {
  dir: string;
  dbFile: string;
}

/** Where the desktop app keeps its database; null in a browser, where the data lives in the page's storage. */
export async function getDataLocation(): Promise<DataLocation | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const found = await invoke<{ dir: string; db_file: string }>('data_location');
  return { dir: found.dir, dbFile: found.db_file };
}

/** Shows the database file in the system file manager. */
export async function revealDataFile(location: DataLocation): Promise<void> {
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(location.dbFile);
}

export async function appVersion(): Promise<string> {
  if (!isTauri()) return 'dev';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}
