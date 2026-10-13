import { describe, expect, it } from 'vitest';
import { newTurnState, summarizeToolInput, translateMessage } from './translate';
import { sdk } from './testing';

const run = (messages: ReturnType<(typeof sdk)['init']>[]) => {
  const state = newTurnState();
  return { state, events: messages.flatMap((m) => translateMessage(m, state, 'c1')) };
};

describe('translateMessage', () => {
  it('streams text deltas and completes with usage and model', () => {
    const { events } = run([
      sdk.init('m1'),
      sdk.start(),
      sdk.delta('Hel'),
      sdk.delta('lo'),
      sdk.assistant([{ type: 'text', text: 'Hello' }]),
      sdk.success(),
    ]);
    expect(events).toEqual([
      { type: 'chat.text', id: 'c1', text: 'Hel' },
      { type: 'chat.text', id: 'c1', text: 'lo' },
      {
        type: 'chat.done',
        id: 'c1',
        status: 'completed',
        model: 'm1',
        usage: { inputTokens: 3, outputTokens: 4 },
        durationMs: 12,
      },
    ]);
  });

  it('falls back to the full assistant text when nothing was streamed', () => {
    const { events } = run([sdk.assistant([{ type: 'text', text: 'whole' }], 'other')]);
    expect(events).toEqual([{ type: 'chat.text', id: 'c1', text: 'whole' }]);
  });

  it('reports tool use and results with a short summary', () => {
    const { events } = run([
      sdk.assistant([
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/a.ts' } },
      ]),
      sdk.toolResult('t1', true),
    ]);
    expect(events).toEqual([
      { type: 'chat.tool_use', id: 'c1', toolUseId: 't1', name: 'Read', summary: 'src/a.ts' },
      { type: 'chat.tool_result', id: 'c1', toolUseId: 't1', isError: true },
    ]);
  });

  it('ignores sub-agent traffic', () => {
    const sub = { ...sdk.delta('x'), parent_tool_use_id: 'tool' } as ReturnType<typeof sdk.delta>;
    expect(run([sub]).events).toEqual([]);
  });

  it('surfaces rate-limit warnings but not "allowed"', () => {
    const { events } = run([
      sdk.rateLimit({ status: 'allowed' }),
      sdk.rateLimit({
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 0.9,
        resetsAt: 1_800_000_000,
      }),
    ]);
    expect(events).toEqual([
      {
        type: 'chat.rate_limit',
        id: 'c1',
        status: 'allowed_warning',
        limitType: 'five_hour',
        resetsAt: 1_800_000_000_000,
        utilization: 0.9,
      },
    ]);
  });

  it('turns an authentication failure into a friendly error, hiding runtime prose', () => {
    const { events } = run([
      sdk.assistant(
        [{ type: 'text', text: 'Invalid API key · Please run /login' }],
        'm',
        'authentication_failed',
      ),
      sdk.failure('Invalid API key · Please run /login'),
    ]);
    expect(events).toEqual([
      { type: 'error', id: 'c1', error: expect.objectContaining({ code: 'auth_required' }) },
    ]);
  });

  it('reports a rejected usage window with its reset time', () => {
    const { events } = run([
      sdk.rateLimit({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_800_000_000 }),
      sdk.assistant([{ type: 'text', text: 'limit' }], 'm', 'rate_limit'),
      sdk.failure('limit'),
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'usage_limit', resetsAt: 1_800_000_000_000, limitType: 'five_hour' },
    });
  });

  it('classifies an unstructured error result by its text', () => {
    const { events } = run([sdk.failure('Not logged in · Please run /login')]);
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'auth_required' } });
  });
});

describe('summarizeToolInput', () => {
  it('picks the first useful field and truncates', () => {
    expect(summarizeToolInput({ pattern: '*.ts' })).toBe('*.ts');
    expect(summarizeToolInput({ command: 'x'.repeat(200) })).toHaveLength(120);
    expect(summarizeToolInput(null)).toBe('');
    expect(summarizeToolInput({ other: 1 })).toBe('');
  });
});
