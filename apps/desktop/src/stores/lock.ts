import { create } from 'zustand';
import {
  checkPin,
  createRecord,
  isValidPin,
  lockoutSeconds,
  parseRecord,
  type LockRecord,
} from '../lib/app-lock';

const RECORD_KEY = 'geeked-lock';
const PREFS_KEY = 'geeked-lock-prefs';

/** Minutes of inactivity before locking; 0 turns it off. */
export const AUTO_LOCK_CHOICES = [0, 5, 15, 30, 60] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number];

interface Prefs {
  /** The user chose to continue without a PIN. */
  skipped: boolean;
  autoLockMinutes: AutoLockMinutes;
  /** Consecutive wrong PINs, persisted so a restart does not reset the delay. */
  failures: number;
  /** Epoch ms until which attempts are refused. */
  lockedUntil: number;
}

const DEFAULT_PREFS: Prefs = { skipped: false, autoLockMinutes: 15, failures: 0, lockedUntil: 0 };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRecord(): LockRecord | null {
  return parseRecord(storage()?.getItem(RECORD_KEY) ?? null);
}

function readPrefs(): Prefs {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw) as Partial<Prefs>;
    return {
      skipped: v.skipped === true,
      autoLockMinutes: AUTO_LOCK_CHOICES.includes(v.autoLockMinutes as AutoLockMinutes)
        ? (v.autoLockMinutes as AutoLockMinutes)
        : DEFAULT_PREFS.autoLockMinutes,
      failures: Number.isInteger(v.failures) ? Math.max(0, v.failures as number) : 0,
      lockedUntil: typeof v.lockedUntil === 'number' ? v.lockedUntil : 0,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

const writePrefs = (prefs: Prefs) => {
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Without storage the lock still works for this session.
  }
};

export type LockPhase = 'setup' | 'locked' | 'unlocked';
export type UnlockResult = 'ok' | 'wrong' | 'wait' | 'invalid';

interface LockState {
  phase: LockPhase;
  /** A PIN exists (whether or not the app is currently locked). */
  hasPin: boolean;
  autoLockMinutes: AutoLockMinutes;
  failures: number;
  lockedUntil: number;

  /** Creates the first PIN and enters the app. */
  setup: (pin: string) => Promise<void>;
  /** Continue without a PIN; it can be added later in Settings. */
  skip: () => void;
  unlock: (pin: string) => Promise<UnlockResult>;
  lock: () => void;
  changePin: (current: string, next: string) => Promise<boolean>;
  removePin: (current: string) => Promise<boolean>;
  addPin: (pin: string) => Promise<void>;
  setAutoLock: (minutes: AutoLockMinutes) => void;
  /** Forgets the PIN and every local chat. The only way back in without the PIN. */
  forgetEverything: () => Promise<void>;
}

function initial(): Pick<
  LockState,
  'phase' | 'hasPin' | 'autoLockMinutes' | 'failures' | 'lockedUntil'
> {
  const record = readRecord();
  const prefs = readPrefs();
  return {
    phase: record ? 'locked' : prefs.skipped ? 'unlocked' : 'setup',
    hasPin: record !== null,
    autoLockMinutes: prefs.autoLockMinutes,
    failures: prefs.failures,
    lockedUntil: prefs.lockedUntil,
  };
}

export const useLockStore = create<LockState>()((set, get) => {
  const saveRecord = (record: LockRecord | null) => {
    try {
      if (record) storage()?.setItem(RECORD_KEY, JSON.stringify(record));
      else storage()?.removeItem(RECORD_KEY);
    } catch {
      // See writePrefs.
    }
  };
  const persist = (patch: Partial<Prefs>) => {
    const { autoLockMinutes, failures, lockedUntil } = get();
    const current = readPrefs();
    writePrefs({ skipped: current.skipped, autoLockMinutes, failures, lockedUntil, ...patch });
  };

  return {
    ...initial(),

    setup: async (pin) => {
      if (!isValidPin(pin)) return;
      saveRecord(await createRecord(pin));
      persist({ skipped: false, failures: 0, lockedUntil: 0 });
      set({ phase: 'unlocked', hasPin: true, failures: 0, lockedUntil: 0 });
    },

    skip: () => {
      persist({ skipped: true });
      set({ phase: 'unlocked', hasPin: false });
    },

    unlock: async (pin) => {
      const now = Date.now();
      if (get().lockedUntil > now) return 'wait';
      const record = readRecord();
      if (!record) {
        set({ phase: 'unlocked', hasPin: false });
        return 'ok';
      }
      if (!isValidPin(pin)) return 'invalid';
      if (await checkPin(record, pin)) {
        persist({ failures: 0, lockedUntil: 0 });
        set({ phase: 'unlocked', failures: 0, lockedUntil: 0 });
        return 'ok';
      }
      const failures = get().failures + 1;
      const wait = lockoutSeconds(failures);
      const lockedUntil = wait > 0 ? Date.now() + wait * 1000 : 0;
      persist({ failures, lockedUntil });
      set({ failures, lockedUntil });
      return wait > 0 ? 'wait' : 'wrong';
    },

    lock: () => {
      if (get().hasPin) set({ phase: 'locked' });
    },

    changePin: async (current, next) => {
      const record = readRecord();
      if (!record || !isValidPin(next) || !(await checkPin(record, current))) return false;
      saveRecord(await createRecord(next));
      return true;
    },

    removePin: async (current) => {
      const record = readRecord();
      if (!record || !(await checkPin(record, current))) return false;
      saveRecord(null);
      persist({ skipped: true, failures: 0, lockedUntil: 0 });
      set({ hasPin: false, failures: 0, lockedUntil: 0 });
      return true;
    },

    addPin: async (pin) => {
      if (!isValidPin(pin)) return;
      saveRecord(await createRecord(pin));
      persist({ skipped: false });
      set({ hasPin: true });
    },

    setAutoLock: (autoLockMinutes) => {
      persist({ autoLockMinutes });
      set({ autoLockMinutes });
    },

    forgetEverything: async () => {
      const [{ getDb }, { clearData }] = await Promise.all([
        import('../lib/db'),
        import('../lib/data'),
      ]);
      await clearData(await getDb(), 'everything');
      saveRecord(null);
      writePrefs({ ...DEFAULT_PREFS, skipped: false });
      window.location.reload();
    },
  };
});
