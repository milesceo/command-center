/**
 * Names from before the app was renamed to Geeked, and the one-time copy of the settings stored
 * under them. With `src-tauri/src/migrate.rs` this is the only place the old name may appear.
 *
 * The webview profile (and with it localStorage) is carried over by the Rust migration; this
 * copies each old key to its new name the first time the new one is missing. Old keys are left
 * in place, never deleted.
 */

/** [old key, new key] for every localStorage entry the app persists. */
export const LEGACY_STORAGE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['programish-ui', 'geeked-ui'],
  ['programish-settings', 'geeked-settings'],
  ['programish-ide', 'geeked-ide'],
  ['programish-lock', 'geeked-lock'],
  ['programish-lock-prefs', 'geeked-lock-prefs'],
];

/** Prompt-library files exported before the rename still import. */
export const LEGACY_LIBRARY_FORMAT = 'programish-prompts';

/** Copies each old key to its new name when the new one is absent. Returns the keys copied. */
export function migrateLegacyStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): string[] {
  const copied: string[] = [];
  for (const [oldKey, newKey] of LEGACY_STORAGE_KEYS) {
    try {
      if (storage.getItem(newKey) !== null) continue;
      const value = storage.getItem(oldKey);
      if (value === null) continue;
      storage.setItem(newKey, value);
      copied.push(newKey);
    } catch {
      // Storage can be blocked or full; the app then simply starts with defaults.
    }
  }
  return copied;
}
