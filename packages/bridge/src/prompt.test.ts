import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt';

describe('buildPrompt', () => {
  it('passes a lone message through untouched', () => {
    expect(buildPrompt([{ role: 'user', content: 'hello' }])).toBe('hello');
  });

  it('inlines attachments before the message text', () => {
    const prompt = buildPrompt([
      { role: 'user', content: 'review', attachments: [{ name: 'a.ts', text: 'let x = 1;' }] },
    ]);
    expect(prompt).toBe('<attachment name="a.ts">\nlet x = 1;\n</attachment>\n\nreview');
  });

  it('replays earlier turns as a transcript and ends with the latest user message', () => {
    const prompt = buildPrompt([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]);
    expect(prompt).toContain('<transcript>\n[user]\none\n\n[assistant]\ntwo\n</transcript>');
    expect(prompt.endsWith('[user]\nthree')).toBe(true);
  });

  it('drops the oldest turns first when over budget, keeping the latest', () => {
    const prompt = buildPrompt(
      [
        { role: 'user', content: 'a'.repeat(100) },
        { role: 'assistant', content: 'b'.repeat(100) },
        { role: 'user', content: 'latest' },
      ],
      150,
    );
    expect(prompt).toContain('1 earlier message(s) omitted');
    expect(prompt).toContain('b'.repeat(100));
    expect(prompt).not.toContain('a'.repeat(100));
    expect(prompt.endsWith('latest')).toBe(true);
  });

  it('keeps only the latest message when nothing else fits', () => {
    const prompt = buildPrompt(
      [
        { role: 'user', content: 'x'.repeat(500) },
        { role: 'user', content: 'latest' },
      ],
      50,
    );
    expect(prompt).toBe('[1 earlier message(s) omitted for length]\n\nlatest');
  });
});
