import { describe, expect, it } from 'vitest';
import { extractVariables, missingVariables, renderPrompt } from './prompt-vars';

describe('extractVariables', () => {
  it('finds unique names in order, tolerating spaces', () => {
    expect(
      extractVariables('Review {{ language }} code for {{audience}}; {{language}} again'),
    ).toEqual(['language', 'audience']);
  });
  it('accepts underscores, dots and dashes, and ignores things that are not variables', () => {
    expect(extractVariables('{{a_b}} {{c.d}} {{e-f}}')).toEqual(['a_b', 'c.d', 'e-f']);
    expect(extractVariables('{{}} {{1abc}} { {x} } {{ }} plain')).toEqual([]);
  });
});

describe('renderPrompt', () => {
  it('replaces every occurrence', () => {
    expect(renderPrompt('Hi {{name}}, {{ name }}!', { name: 'Ada' })).toBe('Hi Ada, Ada!');
  });
  it('turns missing values into empty text and never re-expands inserted text', () => {
    expect(renderPrompt('[{{a}}][{{b}}]', { a: '{{b}}' })).toBe('[{{b}}][]');
  });
  it('inserts special replacement patterns literally', () => {
    expect(renderPrompt('{{x}}', { x: '$& $1 $$' })).toBe('$& $1 $$');
  });
});

describe('missingVariables', () => {
  it('lists variables with no usable value', () => {
    expect(missingVariables('{{a}} {{b}} {{c}}', { a: 'x', b: '   ' })).toEqual(['b', 'c']);
  });
});
