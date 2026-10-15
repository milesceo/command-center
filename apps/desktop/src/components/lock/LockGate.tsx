import { useEffect, type ReactNode } from 'react';
import { useLockStore } from '../../stores/lock';
import { usePrefs } from '../../stores/prefs';
import { LockScreen } from './LockScreen';

/** How often idleness is checked. */
const IDLE_CHECK_MS = 15_000;

function IdleLock() {
  const minutes = usePrefs((s) => s.prefs.security.autoLockMinutes);
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
 * Shows the app only while unlocked. While locked (or while the PIN state is still being read)
 * nothing but the lock screen, or a blank frame, is rendered, so no conversation content is in
 * the DOM behind it.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const phase = useLockStore((s) => s.phase);
  if (phase === 'checking') return null;
  if (phase === 'locked') return <LockScreen />;
  return (
    <>
      {children}
      <IdleLock />
    </>
  );
}
