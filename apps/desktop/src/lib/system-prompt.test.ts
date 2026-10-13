import { describe, expect, it } from 'vitest';
import { resolveSystemPrompt } from './system-prompt';

const prompts = [
  { id: 's1', kind: 'system' as const, title: 'Terse', body: 'Be terse about {{topic}}.' },
  { id: 's2', kind: 'system' as const, title: 'Pirate', body: 'Talk like a pirate.' },
  { id: 'p1', kind: 'prompt' as const, title: 'Not a system prompt', body: 'x' },
];
const none = { systemPrompt: null, systemPromptId: null, systemPromptVars: {} };
const project = (id: string | null, vars: Record<string, string> = {}) => ({
  defaultSystemPromptId: id,
  defaultSystemPromptVars: vars,
});

describe('resolveSystemPrompt', () => {
  it('prefers text written for the conversation over everything else', () => {
    expect(
      resolveSystemPrompt(
        { ...none, systemPrompt: '  custom  ', systemPromptId: 's2' },
        project('s1'),
        prompts,
      ),
    ).toEqual({ text: 'custom', source: 'conversation', title: null });
  });

  it('renders an attached library prompt with its stored variables', () => {
    expect(
      resolveSystemPrompt(
        { ...none, systemPromptId: 's1', systemPromptVars: { topic: 'Rust' } },
        project('s2'),
        prompts,
      ),
    ).toEqual({
      text: 'Be terse about Rust.',
      source: 'library',
      title: 'Terse',
    });
  });

  it("falls back to the project default, with the project's variable values", () => {
    expect(resolveSystemPrompt(none, project('s1', { topic: 'SQL' }), prompts)).toEqual({
      text: 'Be terse about SQL.',
      source: 'project',
      title: 'Terse',
    });
  });

  it('ignores missing prompts, plain prompts and conversations without a project', () => {
    expect(
      resolveSystemPrompt({ ...none, systemPromptId: 'gone' }, project('p1'), prompts),
    ).toEqual({ text: null, source: 'none', title: null });
    expect(resolveSystemPrompt(none, null, prompts).source).toBe('none');
  });

  it('treats a blank custom prompt as unset', () => {
    expect(
      resolveSystemPrompt({ ...none, systemPrompt: '   ', systemPromptId: 's2' }, null, prompts)
        .source,
    ).toBe('library');
  });
});
