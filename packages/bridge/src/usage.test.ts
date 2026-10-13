import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  SDKControlGetUsageResponse,
  SDKRateLimitInfo,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { newTurnState, translateMessage } from './translate';
import { reportFromUsage, usageFromResult, windowsFromRateLimitInfo } from './usage';

/** Real messages captured from the SDK (a one-word haiku reply), not hand-written. */
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url)), 'utf8'),
  );

const realResult = fixture('result-success.json') as SDKResultMessage & {
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  total_cost_usd: number;
};
const realRateLimit = fixture('rate-limit-event.json') as { rate_limit_info: SDKRateLimitInfo };

describe('usageFromResult with a real SDK result', () => {
  it('records exactly the tokens and cost the SDK reported', () => {
    const usage = usageFromResult(realResult, 'ignored');
    expect(usage).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheCreationTokens: 1225,
      costUsd: 0.0002472,
      models: [
        {
          model: 'claude-haiku-5-5',
          inputTokens: 2,
          outputTokens: 4,
          cacheReadTokens: 0,
          cacheCreationTokens: 1225,
          costUsd: 0.0002472,
        },
      ],
    });
  });

  it('agrees with the main-loop usage and the total cost in the same result', () => {
    const usage = usageFromResult(realResult, undefined);
    expect(usage.inputTokens).toBe(realResult.usage.input_tokens);
    expect(usage.outputTokens).toBe(realResult.usage.output_tokens);
    expect(usage.cacheReadTokens).toBe(realResult.usage.cache_read_input_tokens);
    expect(usage.cacheCreationTokens).toBe(realResult.usage.cache_creation_input_tokens);
    expect(usage.costUsd).toBeCloseTo(realResult.total_cost_usd, 10);
  });

  it('survives translation into the chat.done event unchanged', () => {
    const [done] = translateMessage(realResult as SDKResultMessage, newTurnState(), 'c1');
    expect(done).toMatchObject({
      type: 'chat.done',
      status: 'completed',
      usage: { outputTokens: 4, cacheCreationTokens: 1225 },
    });
  });
});

describe('usageFromResult variations', () => {
  const result = (over: object) => ({ ...realResult, ...over }) as SDKResultMessage;
  const u = (model: Partial<Record<string, number | string>>) => ({
    inputTokens: 10,
    outputTokens: 5,
    cacheReadInputTokens: 100,
    cacheCreationInputTokens: 20,
    webSearchRequests: 0,
    costUSD: 0.01,
    contextWindow: 1,
    maxOutputTokens: 1,
    ...model,
  });

  it('sums several models and their costs', () => {
    const usage = usageFromResult(
      result({ modelUsage: { a: u({}), b: u({ inputTokens: 1, costUSD: 0.02 }) } }),
      undefined,
    );
    expect(usage).toMatchObject({
      inputTokens: 11,
      outputTokens: 10,
      cacheReadTokens: 200,
      cacheCreationTokens: 40,
    });
    expect(usage.costUsd).toBeCloseTo(0.03, 10);
    expect(usage.models.map((m) => m.model)).toEqual(['a', 'b']);
  });

  it('leaves cost out when the SDK priced a model by guess', () => {
    const usage = usageFromResult(
      result({ modelUsage: { a: u({ costBasis: 'unknown' }) } }),
      undefined,
    );
    expect(usage.costUsd).toBeUndefined();
    expect(usage.models[0]).not.toHaveProperty('costUsd');
    expect(usage.inputTokens).toBe(10);
  });

  it('falls back to the main-loop usage when there is no per-model data', () => {
    const usage = usageFromResult(result({ modelUsage: {} }), 'claude-x');
    expect(usage).toMatchObject({
      inputTokens: 2,
      outputTokens: 4,
      cacheCreationTokens: 1225,
      models: [{ model: 'claude-x' }],
    });
    expect(usage.costUsd).toBeCloseTo(0.0002472, 10);
    expect(usageFromResult(result({ modelUsage: undefined }), undefined).models[0]?.model).toBe(
      'unknown',
    );
  });
});

describe('plan windows from a rate-limit event', () => {
  it('reads the real event: fractions and unix seconds become 0..1 and milliseconds', () => {
    expect(windowsFromRateLimitInfo(realRateLimit.rate_limit_info)).toEqual([
      { key: 'five_hour', label: '5-hour', utilization: 0.1, resetsAt: 1_791_916_800_000 },
      { key: 'seven_day', label: 'Weekly', utilization: 0.02, resetsAt: 1_792_458_000_000 },
    ]);
  });

  it('ignores events without windows and tolerates junk', () => {
    expect(windowsFromRateLimitInfo({ status: 'allowed' })).toEqual([]);
    const junk = {
      status: 'allowed',
      unifiedWindows: {
        five_hour: 'x',
        seven_day: { utilization: 'high', resetsAt: null },
        odd: { utilization: 7 },
      },
    };
    expect(windowsFromRateLimitInfo(junk as unknown as SDKRateLimitInfo)).toEqual([
      { key: 'seven_day', label: 'Weekly', utilization: null, resetsAt: null },
      { key: 'odd', label: 'odd', utilization: 1, resetsAt: null },
    ]);
  });
});

describe('reportFromUsage (the SDK /usage control response)', () => {
  const base = {
    session: {
      total_cost_usd: 0,
      total_api_duration_ms: 0,
      total_duration_ms: 1,
      total_lines_added: 0,
      total_lines_removed: 0,
      model_usage: {},
    },
    behaviors: null,
  };

  it('reports that plan limits do not apply to this login', () => {
    const response = {
      ...base,
      subscription_type: null,
      rate_limits_available: false,
      rate_limits: null,
    } as unknown as SDKControlGetUsageResponse;
    expect(reportFromUsage('u', response)).toEqual({
      type: 'usage.report',
      id: 'u',
      available: false,
      subscriptionType: null,
      windows: [],
      extraUsage: null,
    });
  });

  it('maps percent and ISO times, per-model windows and extra usage', () => {
    const response = {
      ...base,
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 42, resets_at: '2026-10-13T20:00:00Z' },
        seven_day: { utilization: 7.5, resets_at: null },
        seven_day_opus: null,
        model_scoped: [
          { display_name: 'Fable', utilization: 100, resets_at: '2026-10-20T00:00:00Z' },
        ],
        extra_usage: {
          is_enabled: true,
          monthly_limit: 50,
          used_credits: 5,
          utilization: 10,
          currency: 'USD',
        },
      },
    } as unknown as SDKControlGetUsageResponse;
    const report = reportFromUsage('u', response);
    expect(report.available).toBe(true);
    expect(report.subscriptionType).toBe('max');
    expect(report.windows).toEqual([
      {
        key: 'five_hour',
        label: '5-hour',
        utilization: 0.42,
        resetsAt: Date.parse('2026-10-13T20:00:00Z'),
      },
      { key: 'seven_day', label: 'Weekly', utilization: 0.075, resetsAt: null },
      {
        key: 'model:Fable',
        label: 'Weekly (Fable)',
        utilization: 1,
        resetsAt: Date.parse('2026-10-20T00:00:00Z'),
      },
    ]);
    expect(report.extraUsage).toEqual({
      enabled: true,
      usedCredits: 5,
      monthlyLimit: 50,
      utilization: 0.1,
      currency: 'USD',
    });
  });
});
