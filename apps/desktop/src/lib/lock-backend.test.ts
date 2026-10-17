// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecord } from './app-lock';
import { LEGACY_STORAGE_KEYS, migrateLegacyStorage } from './legacy';

// The old lock keys, newest earlier name first (spelled through legacy.ts: the former names may
// only appear in the files scripts/check-name.mjs allows).
const PREVIOUS_PREFS = LEGACY_STORAGE_KEYS.find(([, n]) => n === 'command-center-prefs')?.[0] ?? '';
const [PREVIOUS_LOCK, FIRST_LOCK] = LEGACY_STORAGE_KEYS.filter(
  ([, next]) => next === 'command-center-lock',
).map(([old]) => old) as [string, string];

// A stand-in for the Rust lock (`lock.rs`): one PIN, compared in plain text (hashing is Rust's job).
const rust = vi.hoisted(() => {
  const state = { pin: null as string | null, calls: [] as string[] };
  const verify = (pin: unknown) =>
    state.pin === null
      ? { outcome: 'no_pin', failures: 0, lockedUntilMs: 0 }
      : pin === state.pin
        ? { outcome: 'ok', failures: 0, lockedUntilMs: 0 }
        : { outcome: 'wrong', failures: 1, lockedUntilMs: 0 };
  const invoke = vi.fn((command: string, args?: Record<string, unknown>) => {
    state.calls.push(command);
    switch (command) {
      case 'lock_status':
        return Promise.resolve({ hasPin: state.pin !== null, failures: 0, lockedUntilMs: 0 });
      case 'lock_set_pin':
        state.pin = args?.pin as string;
        return Promise.resolve(null);
      case 'lock_verify':
        return Promise.resolve(verify(args?.pin));
      case 'lock_change': {
        const r = verify(args?.current);
        if (r.outcome === 'ok') state.pin = args?.next as string;
        return Promise.resolve(r);
      }
      case 'lock_remove': {
        const r = verify(args?.current);
        if (r.outcome === 'ok') state.pin = null;
        return Promise.resolve(r);
      }
      case 'lock_wipe':
        state.pin = null;
        return Promise.resolve(null);
      default:
        return Promise.reject(new Error(`unexpected command ${command}`));
    }
  });
  return { state, invoke };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: rust.invoke }));

const { tauriLockBackend: backend } = await import('./lock-backend');

/** A PBKDF2 record as an earlier version wrote it (few iterations to keep the test fast). */
const oldRecord = async (pin: string) => JSON.stringify(await createRecord(pin, 1000));

beforeEach(() => {
  localStorage.clear();
  rust.state.pin = null;
  rust.state.calls = [];
  rust.invoke.mockClear();
});

describe('tauriLockBackend and the legacy localStorage record', () => {
  it('reports a PIN from an old record while Rust has none, and upgrades it on unlock', async () => {
    localStorage.setItem('command-center-lock', await oldRecord('2468'));
    expect((await backend.status()).hasPin).toBe(true);

    expect((await backend.verify('1111')).outcome).toBe('wrong');
    expect(rust.state.pin).toBeNull();
    expect(localStorage.getItem('command-center-lock')).not.toBeNull();

    expect((await backend.verify('2468')).outcome).toBe('ok');
    expect(rust.state.pin).toBe('2468');
    expect(localStorage.getItem('command-center-lock')).toBeNull();
  });

  it('clears the old record and its prefs whenever Rust reports a PIN', async () => {
    rust.state.pin = '1234';
    localStorage.setItem('command-center-lock', await oldRecord('9999'));
    localStorage.setItem('command-center-lock-prefs', '{"autoLockMinutes":5}');
    expect(await backend.status()).toEqual({ hasPin: true, failures: 0, lockedUntilMs: 0 });
    expect(localStorage.getItem('command-center-lock')).toBeNull();
    expect(localStorage.getItem('command-center-lock-prefs')).toBeNull();
  });

  it('a record copied under the previous name does not come back after Remove PIN', async () => {
    // Profile from the previous name: Rust holds the PIN, but a stale PBKDF2 record is still in localStorage.
    rust.state.pin = '1234';
    localStorage.setItem(PREVIOUS_LOCK, await oldRecord('9999'));
    expect(migrateLegacyStorage(localStorage)).toContain('command-center-lock');

    expect((await backend.status()).hasPin).toBe(true); // clears the copied record
    expect(localStorage.getItem('command-center-lock')).toBeNull();

    expect((await backend.remove('1234')).outcome).toBe('ok');
    expect(rust.state.pin).toBeNull();

    // Next launch: the copy does not run again and nothing reports a PIN.
    expect(migrateLegacyStorage(localStorage)).toEqual([]);
    expect(await backend.status()).toEqual({ hasPin: false, failures: 0, lockedUntilMs: 0 });
    expect((await backend.verify('9999')).outcome).toBe('no_pin');
  });

  it('Remove PIN drops a copied record even when status() never ran first', async () => {
    rust.state.pin = '1234';
    localStorage.setItem(PREVIOUS_LOCK, await oldRecord('9999'));
    migrateLegacyStorage(localStorage);

    expect((await backend.remove('1234')).outcome).toBe('ok');
    expect(localStorage.getItem('command-center-lock')).toBeNull();
    migrateLegacyStorage(localStorage);
    expect((await backend.status()).hasPin).toBe(false);
  });

  it('a wrong PIN on Remove keeps everything as it was', async () => {
    rust.state.pin = '1234';
    const record = await oldRecord('9999');
    localStorage.setItem('command-center-lock', record);
    expect((await backend.remove('0000')).outcome).toBe('wrong');
    expect(rust.state.pin).toBe('1234');
    expect(localStorage.getItem('command-center-lock')).toBe(record);
  });

  it('a record copied under the previous name does not come back after Forgot PIN', async () => {
    rust.state.pin = '1234';
    localStorage.setItem(PREVIOUS_LOCK, await oldRecord('9999'));
    localStorage.setItem(FIRST_LOCK, await oldRecord('5555'));
    migrateLegacyStorage(localStorage);

    await backend.wipe();
    expect(rust.state.pin).toBeNull();
    expect(localStorage.getItem('command-center-lock')).toBeNull();

    migrateLegacyStorage(localStorage);
    expect((await backend.status()).hasPin).toBe(false);
    // The old keys are never deleted, only ignored.
    expect(localStorage.getItem(PREVIOUS_LOCK)).not.toBeNull();
  });

  it('setPin drops an old record so it cannot outlive the new PIN', async () => {
    localStorage.setItem('command-center-lock', await oldRecord('9999'));
    await backend.setPin('4321');
    expect(localStorage.getItem('command-center-lock')).toBeNull();
    await backend.remove('4321');
    expect((await backend.status()).hasPin).toBe(false);
  });

  it('ignores a corrupt old record', async () => {
    localStorage.setItem('command-center-lock', '{"not":"a record"');
    expect((await backend.status()).hasPin).toBe(false);
    expect((await backend.verify('1234')).outcome).toBe('no_pin');
  });

  it('survives localStorage throwing while clearing', async () => {
    rust.state.pin = '1234';
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect((await backend.status()).hasPin).toBe(true);
      expect((await backend.remove('1234')).outcome).toBe('ok');
    } finally {
      spy.mockRestore();
    }
  });

  // A profile from the release that moved the PIN to Rust (it has the previous name's prefs key)
  // where the user removed the PIN: the previous name kept re-copying the first name's record on
  // every launch, so a stale record is still there. It must not come back.
  it('a PIN removed under the previous name does not reappear after the copy', async () => {
    rust.state.pin = null; // removed under the previous name
    localStorage.setItem(PREVIOUS_PREFS, '{"version":3}');
    localStorage.setItem(FIRST_LOCK, await oldRecord('9999'));
    localStorage.setItem(PREVIOUS_LOCK, await oldRecord('9999'));
    migrateLegacyStorage(localStorage);
    expect((await backend.status()).hasPin).toBe(false);
    expect(localStorage.getItem(PREVIOUS_LOCK)).not.toBeNull(); // old keys are left alone
  });

  it('a profile from before the PIN moved to Rust keeps its PIN', async () => {
    rust.state.pin = null;
    localStorage.setItem(PREVIOUS_LOCK, await oldRecord('2468'));
    migrateLegacyStorage(localStorage);
    expect((await backend.status()).hasPin).toBe(true);
    expect((await backend.verify('2468')).outcome).toBe('ok');
  });
});
