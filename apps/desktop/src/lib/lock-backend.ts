import {
  checkPin,
  createRecord,
  isValidPin,
  lockoutSeconds,
  parseRecord,
  type LockRecord,
} from './app-lock';
import { isTauri } from './tauri';

/**
 * Where the PIN lives and who checks it.
 *
 * - Desktop app: Rust (`lock.rs`): Argon2id, attempt counters persisted outside webview storage.
 * - Plain browser (dev preview, tests, e2e): PBKDF2 in localStorage, same rules and delays.
 *
 * The store only talks to this interface, so the screens behave the same in both.
 */

export type VerifyOutcome = 'ok' | 'wrong' | 'wait' | 'no_pin';

export interface VerifyResult {
  outcome: VerifyOutcome;
  failures: number;
  lockedUntilMs: number;
}

export interface LockStatus {
  hasPin: boolean;
  failures: number;
  lockedUntilMs: number;
}

export interface LockBackend {
  status(): Promise<LockStatus>;
  setPin(pin: string): Promise<void>;
  verify(pin: string): Promise<VerifyResult>;
  /** Replaces the PIN when `current` verifies. */
  change(current: string, next: string): Promise<VerifyResult>;
  /** Removes the PIN when `current` verifies. */
  remove(current: string): Promise<VerifyResult>;
  /** Forgets the PIN and the attempt counters unconditionally ("Forgot PIN"). */
  wipe(): Promise<void>;
}

/** Keys the previous (PBKDF2, localStorage) lock used. Read only to upgrade; cleared afterwards. */
const LEGACY_RECORD_KEY = 'geeked-lock';
const LEGACY_PREFS_KEY = 'geeked-lock-prefs';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLegacyRecord(): LockRecord | null {
  return parseRecord(storage()?.getItem(LEGACY_RECORD_KEY) ?? null);
}

function clearLegacy(): void {
  try {
    storage()?.removeItem(LEGACY_RECORD_KEY);
    storage()?.removeItem(LEGACY_PREFS_KEY);
  } catch {
    // Nothing to do: the legacy record is simply ignored once Rust has a PIN.
  }
}

// ----------------------------------------------------------------- desktop

interface RustStatus {
  hasPin: boolean;
  failures: number;
  lockedUntilMs: number;
}
interface RustVerify {
  outcome: 'no_pin' | 'ok' | 'wrong' | 'wait';
  failures: number;
  lockedUntilMs: number;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export const tauriLockBackend: LockBackend = {
  async status() {
    const status = await invoke<RustStatus>('lock_status');
    if (status.hasPin) return status;
    // A PIN written by an earlier version still counts until it is upgraded on first unlock.
    return readLegacyRecord() ? { ...status, hasPin: true } : status;
  },

  async setPin(pin) {
    await invoke('lock_set_pin', { pin });
    clearLegacy();
  },

  async verify(pin) {
    const status = await invoke<RustStatus>('lock_status');
    if (!status.hasPin) {
      const legacy = readLegacyRecord();
      if (legacy) {
        if (await checkPin(legacy, pin)) {
          // Upgrade: re-hash with Argon2id in Rust, then drop the old record.
          await invoke('lock_set_pin', { pin });
          clearLegacy();
          return { outcome: 'ok', failures: 0, lockedUntilMs: 0 };
        }
        return { outcome: 'wrong', failures: 0, lockedUntilMs: 0 };
      }
    }
    return invoke<RustVerify>('lock_verify', { pin });
  },

  change: (current, next) => invoke<RustVerify>('lock_change', { current, next }),
  remove: (current) => invoke<RustVerify>('lock_remove', { current }),

  async wipe() {
    await invoke('lock_wipe');
    clearLegacy();
  },
};

// ----------------------------------------------------------------- browser

const WEB_STATE_KEY = 'geeked-lock-web';

interface WebState {
  failures: number;
  lockedUntilMs: number;
}

function readWebState(): WebState {
  try {
    const v = JSON.parse(storage()?.getItem(WEB_STATE_KEY) ?? '{}') as Partial<WebState>;
    return {
      failures: Number.isInteger(v.failures) ? Math.max(0, v.failures as number) : 0,
      lockedUntilMs: typeof v.lockedUntilMs === 'number' ? v.lockedUntilMs : 0,
    };
  } catch {
    return { failures: 0, lockedUntilMs: 0 };
  }
}

function writeWebState(state: WebState): void {
  try {
    storage()?.setItem(WEB_STATE_KEY, JSON.stringify(state));
  } catch {
    // Without storage the delay only lasts for this session.
  }
}

export const webLockBackend: LockBackend = {
  async status() {
    return { hasPin: readLegacyRecord() !== null, ...toStatus(readWebState()) };
  },

  async setPin(pin) {
    if (!isValidPin(pin)) throw new Error('Invalid PIN.');
    storage()?.setItem(LEGACY_RECORD_KEY, JSON.stringify(await createRecord(pin)));
    writeWebState({ failures: 0, lockedUntilMs: 0 });
  },

  async verify(pin) {
    const record = readLegacyRecord();
    const state = readWebState();
    if (!record) return { outcome: 'no_pin', ...state };
    if (state.lockedUntilMs > Date.now()) return { outcome: 'wait', ...state };
    if (isValidPin(pin) && (await checkPin(record, pin))) {
      writeWebState({ failures: 0, lockedUntilMs: 0 });
      return { outcome: 'ok', failures: 0, lockedUntilMs: 0 };
    }
    const failures = state.failures + 1;
    const wait = lockoutSeconds(failures);
    const next = { failures, lockedUntilMs: wait > 0 ? Date.now() + wait * 1000 : 0 };
    writeWebState(next);
    return { outcome: wait > 0 ? 'wait' : 'wrong', ...next };
  },

  async change(current, next) {
    const result = await webLockBackend.verify(current);
    if (result.outcome === 'ok') await webLockBackend.setPin(next);
    return result;
  },

  async remove(current) {
    const result = await webLockBackend.verify(current);
    if (result.outcome === 'ok') clearLegacy();
    return result;
  },

  async wipe() {
    clearLegacy();
    try {
      storage()?.removeItem(WEB_STATE_KEY);
    } catch {
      // See writeWebState.
    }
  },
};

const toStatus = (s: WebState) => ({ failures: s.failures, lockedUntilMs: s.lockedUntilMs });

/** The backend for the current environment. */
export const lockBackend = (): LockBackend => (isTauri() ? tauriLockBackend : webLockBackend);
