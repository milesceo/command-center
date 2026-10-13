import type { StoredWindow } from './repo-usage';

export type Severity = 'ok' | 'warning' | 'critical';

export interface Headroom {
  window: StoredWindow;
  /** Used fraction 0..1, or null when the SDK gave none. */
  used: number | null;
  /** Remaining fraction 0..1; null when unknown or the reading is out of date. */
  remaining: number | null;
  /** True when the window's reset time has passed since the reading, so the figure no longer applies. */
  stale: boolean;
  severity: Severity;
}

/** Fill turns amber above this used fraction and red above the second. */
export const WARN_AT = 0.75;
export const CRITICAL_AT = 0.9;

/**
 * Remaining headroom for a stored window reading. Nothing is extrapolated: a reading
 * whose reset time is in the past is marked stale (the window has rolled over, so
 * the old number no longer says anything), not guessed to be zero.
 */
export function headroom(window: StoredWindow, now = Date.now()): Headroom {
  const stale = window.resetsAt !== null && window.resetsAt <= now;
  const used = window.utilization;
  const usable = used !== null && !stale;
  const severity: Severity = !usable
    ? 'ok'
    : used >= CRITICAL_AT
      ? 'critical'
      : used >= WARN_AT
        ? 'warning'
        : 'ok';
  return { window, used, remaining: usable ? Math.max(0, 1 - used) : null, stale, severity };
}

/** Display order: the rolling session window first, then weekly ones, then per-model. */
const ORDER = [
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_oauth_apps',
];
export function sortWindows<T extends { key: string }>(windows: T[]): T[] {
  const rank = (key: string) => {
    const i = ORDER.indexOf(key);
    return i === -1 ? ORDER.length : i;
  };
  return [...windows].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}
