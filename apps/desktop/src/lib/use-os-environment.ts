import { useEffect, useState } from 'react';
import type { OsEnvironment } from './apply-appearance';

const QUERIES = {
  prefersDark: '(prefers-color-scheme: dark)',
  prefersReducedMotion: '(prefers-reduced-motion: reduce)',
} as const;

const read = (): OsEnvironment => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { prefersDark: true, prefersReducedMotion: false };
  }
  return {
    prefersDark: window.matchMedia(QUERIES.prefersDark).matches,
    prefersReducedMotion: window.matchMedia(QUERIES.prefersReducedMotion).matches,
  };
};

/** The operating system's theme and reduced-motion settings, kept current while mounted. */
export function useOsEnvironment(): OsEnvironment {
  const [env, setEnv] = useState(read);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
    const update = () => setEnv(read());
    for (const list of lists) list.addEventListener('change', update);
    return () => {
      for (const list of lists) list.removeEventListener('change', update);
    };
  }, []);

  return env;
}
