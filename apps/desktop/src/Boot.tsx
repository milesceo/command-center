import { useEffect, useState, type ComponentType } from 'react';
import { Splash } from './components/splash/Splash';
import { useAppearance } from './lib/use-appearance';
import { useBridgeStore } from './stores/bridge';
import { useLockStore } from './stores/lock';

/** The splash never flashes: it stays at least this long once shown. */
export const SPLASH_MIN_MS = 900;
/** A stuck bridge must not trap the user behind the splash. */
export const SPLASH_MAX_MS = 8000;
/** Matches the fade duration on `Splash`. */
const FADE_MS = 300;

type AppModule = { App: ComponentType };

/**
 * The first thing rendered. It draws the splash immediately (a tiny chunk), loads the app in the
 * background, mounts it behind the splash so the bridge starts and the PIN state is read, and
 * removes the splash once the app is ready (and the minimum time has passed). The PIN lock is
 * part of the app, so it appears the moment the splash fades.
 */
export function Boot({ loadApp = () => import('./App') }: { loadApp?: () => Promise<AppModule> }) {
  useAppearance();
  const [App, setApp] = useState<ComponentType | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [shownAt] = useState(() => performance.now());

  const lockPhase = useLockStore((s) => s.phase);
  const bridge = useBridgeStore((s) => s.status);

  useEffect(() => {
    let alive = true;
    void loadApp().then((m) => {
      if (alive) setApp(() => m.App);
    });
    return () => {
      alive = false;
    };
  }, [loadApp]);

  // Ready: the app is mounted, the lock state is known, and the bridge has answered (or failed).
  const ready =
    App !== null && lockPhase !== 'checking' && bridge !== 'idle' && bridge !== 'connecting';

  useEffect(() => {
    if (gone || leaving) return;
    const elapsed = performance.now() - shownAt;
    const wait = ready
      ? Math.max(0, SPLASH_MIN_MS - elapsed)
      : // Not ready yet: give up waiting after the cap, but only once the app itself is there.
        App !== null
        ? Math.max(0, SPLASH_MAX_MS - elapsed)
        : null;
    if (wait === null) return;
    const timer = setTimeout(() => setLeaving(true), wait);
    return () => clearTimeout(timer);
  }, [ready, App, leaving, gone, shownAt]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <>
      {App && <App />}
      {!gone && <Splash leaving={leaving} />}
    </>
  );
}
