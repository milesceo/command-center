/**
 * Names the app had before it became Command Center (first programish, then Geeked), and the
 * one-time copy of the settings stored under them. With `src-tauri/src/migrate.rs` and
 * `src-tauri/src/legacy_keys.rs` this is the only place the old names may appear.
 *
 * The webview profile (and with it localStorage) is carried over by the Rust migration; this
 * copies each old key to its new name the first time the new one is missing. Old keys are left
 * in place, never deleted. The copy runs once per profile (`LEGACY_COPIED_KEY`): the old keys
 * stay behind, so running it again would bring back a value the app has since removed on
 * purpose (a PIN record after "Remove PIN" or "Forgot PIN").
 */

/** Every localStorage key the app persists, without its prefix. */
const PERSISTED_KEYS = [
  'ui',
  'settings',
  'ide',
  'lock',
  'lock-prefs',
  'lock-web',
  'prefs',
  'qa',
  'last-message',
  'status-feed',
  'status-known-models',
] as const;

/** Keys the first name used (a subset: the rest were added under the second name). */
const FIRST_NAME_KEYS = ['ui', 'settings', 'ide', 'lock', 'lock-prefs'] as const;

/**
 * [old key, new key] pairs, newest name first. A profile that went through both renames has its
 * Geeked values copied; a profile that skipped the Geeked releases is copied from the first name.
 * Because a key is only written while the new name is absent, the newer value always wins.
 */
export const LEGACY_STORAGE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ...PERSISTED_KEYS.map((k) => [`geeked-${k}`, `command-center-${k}`] as const),
  ...FIRST_NAME_KEYS.map((k) => [`programish-${k}`, `command-center-${k}`] as const),
];

/** Prompt-library files exported under either earlier name still import. */
export const LEGACY_LIBRARY_FORMATS: readonly string[] = ['geeked-prompts', 'programish-prompts'];

/** The PBKDF2 PIN record of the localStorage-only lock (before the PIN moved to Rust). */
const LOCK_RECORD_KEY = 'command-center-lock';
/** Present only in profiles that ran the release in which the PIN moved to Rust. */
const ARGON2_ERA_KEY = 'geeked-prefs';

/** Set once the copy has run, so it never runs again on this profile. */
export const LEGACY_COPIED_KEY = 'command-center-legacy-copied';

/**
 * Copies each old key to its new name when the new one is absent, the first time it is called on
 * a profile. Returns the keys copied.
 */
export function migrateLegacyStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): string[] {
  const copied: string[] = [];
  try {
    if (storage.getItem(LEGACY_COPIED_KEY) !== null) return copied;
  } catch {
    return copied;
  }
  // The release that introduced `geeked-prefs` also moved the PIN to Rust (Argon2id, carried over
  // as `lock.json` by the Rust migration) and upgraded the localStorage record on first unlock.
  // In such a profile a leftover record is stale: Geeked kept re-copying the first name's record
  // on every launch, even after the user removed the PIN. Copying it would bring that PIN back.
  let staleLockRecord = false;
  try {
    staleLockRecord = storage.getItem(ARGON2_ERA_KEY) !== null;
  } catch {
    // Unreadable storage: the copy below fails the same way.
  }
  for (const [oldKey, newKey] of LEGACY_STORAGE_KEYS) {
    if (staleLockRecord && newKey === LOCK_RECORD_KEY) continue;
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
  try {
    storage.setItem(LEGACY_COPIED_KEY, String(Date.now()));
  } catch {
    // Blocked storage: nothing was copied either, so running again later is harmless.
  }
  return copied;
}
