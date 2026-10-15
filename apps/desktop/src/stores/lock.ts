import { create } from 'zustand';
import { isValidPin } from '../lib/app-lock';
import { lockBackend, type VerifyResult } from '../lib/lock-backend';

export { AUTO_LOCK_CHOICES, type AutoLockMinutes } from '../lib/prefs';

/**
 * - `checking`: asking the backend whether a PIN exists (nothing is rendered yet).
 * - `locked`: a PIN exists and has not been entered this session / since the last lock.
 * - `unlocked`: no PIN, or it was entered.
 */
export type LockPhase = 'checking' | 'locked' | 'unlocked';
export type UnlockResult = 'ok' | 'wrong' | 'wait' | 'invalid';

interface LockState {
  phase: LockPhase;
  /** A PIN exists (whether or not the app is currently locked). */
  hasPin: boolean;
  /** Consecutive wrong PINs, as the backend counted them. */
  failures: number;
  /** Epoch ms until which attempts are refused; 0 when not waiting. */
  lockedUntil: number;

  /** Reads the PIN state from the backend. Called once at startup. */
  init: () => Promise<void>;
  unlock: (pin: string) => Promise<UnlockResult>;
  /** Locks the app now (no-op without a PIN). */
  lock: () => void;
  /** Sets or replaces the PIN without asking for the old one (onboarding, first PIN). */
  setPin: (pin: string) => Promise<void>;
  changePin: (current: string, next: string) => Promise<UnlockResult>;
  removePin: (current: string) => Promise<UnlockResult>;
  /** Forgets the PIN, every API key and every local chat. The only way back in without the PIN. */
  forgetEverything: () => Promise<void>;
}

const toResult = (r: VerifyResult): UnlockResult =>
  r.outcome === 'ok' || r.outcome === 'no_pin' ? 'ok' : r.outcome;

export const useLockStore = create<LockState>()((set, get) => {
  const apply = (r: Pick<VerifyResult, 'failures' | 'lockedUntilMs'>) =>
    set({ failures: r.failures, lockedUntil: r.lockedUntilMs });

  return {
    phase: 'checking',
    hasPin: false,
    failures: 0,
    lockedUntil: 0,

    init: async () => {
      try {
        const status = await lockBackend().status();
        set({
          hasPin: status.hasPin,
          failures: status.failures,
          lockedUntil: status.lockedUntilMs,
          // A PIN always starts the session locked.
          phase: status.hasPin ? 'locked' : 'unlocked',
        });
      } catch {
        // If the lock state cannot be read, fail closed only when a PIN might exist; with no
        // way to tell, the app opens (there is nothing else to protect it with).
        set({ phase: 'unlocked' });
      }
    },

    unlock: async (pin) => {
      if (get().lockedUntil > Date.now()) return 'wait';
      if (!isValidPin(pin)) return 'invalid';
      const result = await lockBackend().verify(pin);
      apply(result);
      if (result.outcome === 'ok' || result.outcome === 'no_pin') {
        set({ phase: 'unlocked', hasPin: result.outcome === 'ok' ? get().hasPin : false });
      }
      return toResult(result);
    },

    lock: () => {
      if (get().hasPin) set({ phase: 'locked' });
    },

    setPin: async (pin) => {
      if (!isValidPin(pin)) throw new Error('Invalid PIN.');
      await lockBackend().setPin(pin);
      set({ hasPin: true, failures: 0, lockedUntil: 0 });
    },

    changePin: async (current, next) => {
      if (!isValidPin(next)) return 'invalid';
      const result = await lockBackend().change(current, next);
      apply(result);
      return toResult(result);
    },

    removePin: async (current) => {
      const result = await lockBackend().remove(current);
      apply(result);
      if (result.outcome === 'ok') set({ hasPin: false, failures: 0, lockedUntil: 0 });
      return toResult(result);
    },

    forgetEverything: async () => {
      const [{ getDb }, { clearData }, { secrets }, { prefsStore }] = await Promise.all([
        import('../lib/db'),
        import('../lib/data'),
        import('../lib/secrets'),
        import('./prefs'),
      ]);
      await clearData(await getDb(), 'everything');
      await secrets.wipe();
      await lockBackend().wipe();
      prefsStore.getState().reset();
      set({ hasPin: false, failures: 0, lockedUntil: 0, phase: 'unlocked' });
      // A clean slate: the reload starts first-run onboarding again.
      window.location.reload();
    },
  };
});

void useLockStore.getState().init();
