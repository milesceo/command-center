import { describe, expect, it } from 'vitest';
import { describeError, describeUsageWarning, formatDuration, formatReset } from './errors';

describe('formatDuration', () => {
  it('shows the two most significant units', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(5 * 60_000)).toBe('5m');
    expect(formatDuration((2 * 60 + 15) * 60_000)).toBe('2h 15m');
    expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe('3d 4h');
    expect(formatDuration(-5)).toBe('0s');
  });
});

describe('formatReset', () => {
  const now = new Date(2026, 9, 13, 12, 0, 0).getTime();
  it('includes the relative time while the reset is in the future', () => {
    expect(formatReset(now + 2 * 3_600_000, now)).toMatch(/\(in 2h 0m\)$/);
  });
  it('adds a weekday for another day and omits the countdown once passed', () => {
    expect(formatReset(now + 30 * 3_600_000, now)).toMatch(/^[A-Za-z]{3} .*\(in 1d 6h\)$/);
    expect(formatReset(now - 1000, now)).not.toContain('(in');
  });
});

describe('describeError', () => {
  it('tells the user to run claude when logged out, without any stack trace', () => {
    const e = describeError({ code: 'auth_required', message: 'Error: at foo.js:1\n  at bar' });
    expect(e.title).toMatch(/not logged in/i);
    expect(e.body).toContain('`claude`');
    expect(e.details).toBeUndefined();
  });

  it('names the limit window and the reset time for usage limits', () => {
    const now = Date.now();
    const e = describeError(
      { code: 'usage_limit', message: 'm', limitType: 'five_hour', resetsAt: now + 3_600_000 },
      now,
    );
    expect(e.body).toContain('5-hour');
    expect(e.body).toContain('resets at');
    expect(e.body).toContain('in 1h 0m');
  });

  it('degrades gracefully when no reset time is known', () => {
    expect(describeError({ code: 'usage_limit', message: 'm' }).body).toContain('/usage');
    expect(describeError({ code: 'rate_limited', message: 'm' }).body).toContain('in a moment');
  });

  it('keeps technical text only as details for unexpected errors', () => {
    expect(describeError({ code: 'internal', message: 'boom' })).toMatchObject({ details: 'boom' });
  });
});

describe('describeUsageWarning', () => {
  it('summarizes utilization and reset', () => {
    const now = Date.now();
    expect(
      describeUsageWarning(
        { limitType: 'five_hour', utilization: 0.904, resetsAt: now + 3_600_000 },
        now,
      ),
    ).toMatch(/^5-hour usage at 90% · resets .*\(in 1h 0m\)$/);
    expect(describeUsageWarning({})).toBe('Usage is getting high');
  });
});

describe('local model errors', () => {
  it('tells the owner to restart Ollama when the engine crashes', () => {
    const friendly = describeError(
      { code: 'overloaded', message: 'the local model server is unavailable (HTTP 500).' },
      undefined,
      'local',
    );
    expect(friendly.title).toBe('The local model engine crashed');
    expect(friendly.body).toMatch(/quit Ollama from the menu bar and open it again/);
    expect(friendly.details).toMatch(/HTTP 500/);
    // Other providers keep their own wording.
    expect(describeError({ code: 'overloaded', message: 'x' }).title).toBe('Claude is overloaded');
  });
});
