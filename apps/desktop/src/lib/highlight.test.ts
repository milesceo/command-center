import { describe, expect, it } from 'vitest';
import { highlightCode as highlightViaEntryPoint } from './highlight';
import { highlightCode, isHighlightable } from './highlight-core';

describe('highlightCode', () => {
  it('tokenizes known languages using css-variable colors', async () => {
    const lines = await highlightCode('const answer = 42;\nconsole.log(answer);', 'typescript');
    expect(lines).toHaveLength(2);
    const colors = new Set(lines?.flat().map((t) => t.color));
    expect([...colors].some((c) => c?.startsWith('var(--shiki-token-keyword'))).toBe(true);
    // Every character survives tokenization.
    expect(lines?.[0]?.map((t) => t.content).join('')).toBe('const answer = 42;');
  });

  it('keeps blank lines and handles several languages', async () => {
    expect(await highlightCode('a\n\nb', 'python')).toHaveLength(3);
    expect(await highlightCode('{"a": [1, 2]}', 'json')).not.toBeNull();
    expect(await highlightCode('fn main() {}', 'rust')).not.toBeNull();
  });

  it('returns null for unknown or empty languages so callers fall back to plain text', async () => {
    expect(await highlightCode('x', 'klingon')).toBeNull();
    expect(await highlightCode('x', '')).toBeNull();
    expect(isHighlightable('typescript')).toBe(true);
    expect(isHighlightable('klingon')).toBe(false);
  });
});

describe('highlight entry point', () => {
  it('falls back to in-thread highlighting where workers are unavailable', async () => {
    expect(typeof Worker).toBe('undefined');
    const lines = await highlightViaEntryPoint('const a = 1;', 'typescript', 'block-1');
    expect(lines?.[0]?.map((t) => t.content).join('')).toBe('const a = 1;');
    expect(await highlightViaEntryPoint('x', 'klingon', 'block-1')).toBeNull();
  });
});
