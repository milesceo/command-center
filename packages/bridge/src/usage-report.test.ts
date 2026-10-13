import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { QueryFn } from './sdk';
import { collector } from './testing';
import { runUsage } from './usage-report';

const response = {
  session: {
    total_cost_usd: 0,
    total_api_duration_ms: 0,
    total_duration_ms: 1,
    total_lines_added: 0,
    total_lines_removed: 0,
    model_usage: {},
  },
  subscription_type: 'pro',
  rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 10, resets_at: '2026-10-13T20:00:00Z' } },
  behaviors: null,
} as unknown as SDKControlGetUsageResponse;

function queryWith(usage: unknown): { query: QueryFn; aborted: () => boolean } {
  let aborted = false;
  const query: QueryFn = ({ options }) => {
    options?.abortController?.signal.addEventListener('abort', () => (aborted = true));
    return Object.assign((async function* () {})(), {
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage as never,
    });
  };
  return { query, aborted: () => aborted };
}

describe('runUsage', () => {
  it('asks the runtime for usage, reports it, and always shuts the runtime down', async () => {
    const out = collector();
    const ask = vi.fn(() => Promise.resolve(response));
    const { query, aborted } = queryWith(ask);
    await runUsage({ query, emit: out.emit }, 'u1');
    expect(ask).toHaveBeenCalledWith({ skipBehaviors: true });
    expect(out.events).toEqual([
      {
        type: 'usage.report',
        id: 'u1',
        available: true,
        subscriptionType: 'pro',
        windows: [
          {
            key: 'five_hour',
            label: '5-hour',
            utilization: 0.1,
            resetsAt: Date.parse('2026-10-13T20:00:00Z'),
          },
        ],
        extraUsage: null,
      },
    ]);
    expect(aborted()).toBe(true);
  });

  it('says so when the SDK build does not have the control request', async () => {
    const out = collector();
    await runUsage({ query: queryWith(undefined).query, emit: out.emit }, 'u1');
    expect(out.events).toEqual([
      {
        type: 'error',
        id: 'u1',
        error: { code: 'internal', message: expect.stringContaining('does not expose plan usage') },
      },
    ]);
  });

  it('turns a failing request into an error event', async () => {
    const out = collector();
    const { query, aborted } = queryWith(() =>
      Promise.reject(new Error('Not logged in · Please run /login')),
    );
    await runUsage({ query, emit: out.emit }, 'u1');
    expect(out.events[0]).toMatchObject({
      type: 'error',
      id: 'u1',
      error: { code: 'auth_required' },
    });
    expect(aborted()).toBe(true);
  });

  it('gives up on a runtime that never answers', async () => {
    const out = collector();
    const { query } = queryWith(() => new Promise(() => {}));
    await runUsage({ query, emit: out.emit }, 'u1', 20);
    expect(out.events[0]).toMatchObject({
      type: 'error',
      error: { message: 'Timed out reading plan usage.' },
    });
  });
});
