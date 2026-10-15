import { useEffect, type ReactNode } from 'react';
import { useLockStore } from '../../stores/lock';
import { LockScreen } from './LockScreen';

/** Locks after this much inactivity, checked at this interval. */
const IDLE_CHECK_MS = 15_000;

function IdleLock() {
  const minutes = useLockStore((s) => s.autoLockMinutes);
  const hasPin = useLockStore((s) => s.hasPin);

  useEffect(() => {
    if (minutes === 0 || !hasPin) return;
    let lastActive = Date.now();
    const touch = () => {
      lastActive = Date.now();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - lastActive >= minutes * 60_000) useLockStore.getState().lock();
    }, IDLE_CHECK_MS);
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      clearInterval(timer);
    };
  }, [minutes, hasPin]);

  return null;
}

/**
 * Shows the app only while unlocked. Locked or first-run states render the lock screen
 * and nothing else, so no conversation content is in the DOM behind it.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const phase = useLockStore((s) => s.phase);
  if (phase === 'unlocked') {
    return (
      <>
        {children}
        <IdleLock />
      </>
    );
  }
  return <LockScreen mode={phase === 'setup' ? 'setup' : 'unlock'} />;
}
