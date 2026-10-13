import { describe, expect, it } from 'vitest';
import { fromAssistantError, fromFailureText, fromThrown, normalizeResetsAt } from './errors';

describe('normalizeResetsAt', () => {
  it('converts seconds to milliseconds and leaves milliseconds alone', () => {
    expect(normalizeResetsAt(1_800_000_000)).toBe(1_800_000_000_000);
    expect(normalizeResetsAt(1_800_000_000_000)).toBe(1_800_000_000_000);
  });
  it('rejects junk', () => {
    expect(normalizeResetsAt(undefined)).toBeUndefined();
    expect(normalizeResetsAt(0)).toBeUndefined();
    expect(normalizeResetsAt(Number.NaN)).toBeUndefined();
  });
});

describe('fromAssistantError', () => {
  it('maps authentication failures', () => {
    expect(fromAssistantError('authentication_failed').code).toBe('auth_required');
  });

  it('treats a rejected subscription window as a usage limit with reset time', () => {
    const e = fromAssistantError('rate_limit', {
      status: 'rejected',
      resetsAt: 1_800_000_000,
      rateLimitType: 'five_hour',
    });
    expect(e).toMatchObject({
      code: 'usage_limit',
      resetsAt: 1_800_000_000_000,
      limitType: 'five_hour',
    });
  });

  it('treats other rate limits as transient throttling', () => {
    expect(fromAssistantError('rate_limit').code).toBe('rate_limited');
    expect(fromAssistantError('rate_limit', { status: 'allowed_warning' }).code).toBe(
      'rate_limited',
    );
  });

  it('maps the remaining categories', () => {
    expect(fromAssistantError('billing_error').code).toBe('account');
    expect(fromAssistantError('overloaded').code).toBe('overloaded');
    expect(fromAssistantError('model_not_found').code).toBe('model_not_found');
    expect(fromAssistantError('server_error').code).toBe('internal');
  });
});

describe('fromFailureText', () => {
  it('recognizes login problems in free text', () => {
    expect(fromFailureText('Not logged in · Please run /login').code).toBe('auth_required');
    expect(fromFailureText('Claude Code process exited with code 1\n401 Unauthorized').code).toBe(
      'auth_required',
    );
  });
  it('recognizes usage limits and a missing runtime', () => {
    expect(fromFailureText('5-hour limit reached').code).toBe('usage_limit');
    expect(fromFailureText('spawn claude ENOENT').code).toBe('sdk_unavailable');
  });
  it('falls back to internal', () => {
    expect(fromFailureText('kaboom')).toEqual({ code: 'internal', message: 'kaboom' });
  });
  it('uses stderr to classify generic exit errors', () => {
    expect(fromThrown(new Error('process exited with code 1'), 'Error: Not logged in').code).toBe(
      'auth_required',
    );
  });
});
