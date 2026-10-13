import { describe, expect, it } from 'vitest';
import { EMPTY_TOTALS } from './repo-usage';
import { dayKey, fillDays, fillWeeks, startOfWeek } from './usage-series';
import { CRITICAL_AT, WARN_AT, headroom, sortWindows } from './usage-windows';

const row = (bucket: string, outputTokens: number) => ({ ...EMPTY_TOTALS, bucket, outputTokens });

describe('series filling', () => {
  const now = new Date(2026, 9, 14, 15, 30); // Wednesday 14 Oct 2026, local

  it('zero-fills days and keeps real rows in place', () => {
    const series = fillDays([row('2026-10-12', 7), row('2026-10-14', 3)], 5, now);
    expect(series.map((p) => p.bucket)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(series.map((p) => p.outputTokens)).toEqual([0, 0, 7, 0, 3]);
  });

  it('crosses month boundaries', () => {
    expect(fillDays([], 3, new Date(2026, 10, 1)).map((p) => p.bucket)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('builds Monday-based weeks ending with the current one', () => {
    expect(dayKey(startOfWeek(now))).toBe('2026-10-12');
    expect(dayKey(startOfWeek(new Date(2026, 9, 18)))).toBe('2026-10-12'); // Sunday belongs to the week before Monday
    const weeks = fillWeeks([row('2026-10-05', 9)], 3, now);
    expect(weeks.map((p) => p.bucket)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(weeks.map((p) => p.outputTokens)).toEqual([0, 9, 0]);
  });
});

describe('headroom', () => {
  const now = 1_000_000;
  const w = (utilization: number | null, resetsAt: number | null) => ({
    key: 'five_hour',
    label: '5-hour',
    utilization,
    resetsAt,
    observedAt: 1,
    source: 'report' as const,
  });

  it('reports remaining headroom and severity from the used fraction', () => {
    expect(headroom(w(0.4, now + 1), now)).toMatchObject({
      used: 0.4,
      remaining: 0.6,
      severity: 'ok',
      stale: false,
    });
    expect(headroom(w(WARN_AT, now + 1), now).severity).toBe('warning');
    expect(headroom(w(CRITICAL_AT, now + 1), now).severity).toBe('critical');
    expect(headroom(w(1.2, now + 1), now).remaining).toBe(0);
  });

  it('does not extrapolate: a window that has reset since the reading is stale, not zero', () => {
    expect(headroom(w(0.95, now - 1), now)).toMatchObject({
      stale: true,
      remaining: null,
      severity: 'ok',
    });
  });

  it('copes with unknown utilization or reset time', () => {
    expect(headroom(w(null, null), now)).toMatchObject({
      used: null,
      remaining: null,
      stale: false,
    });
    expect(headroom(w(0.2, null), now).remaining).toBe(0.8);
  });

  it('orders the session window first, weekly next, per-model last', () => {
    const keys = ['model:Opus', 'seven_day', 'five_hour', 'seven_day_opus'].map((key) => ({ key }));
    expect(sortWindows(keys).map((k) => k.key)).toEqual([
      'five_hour',
      'seven_day',
      'seven_day_opus',
      'model:Opus',
    ]);
  });
});
