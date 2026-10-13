import { describe, expect, it } from 'vitest';
import { splitBlocks } from './markdown-blocks';

describe('splitBlocks', () => {
  it('splits paragraphs at blank lines', () => {
    expect(splitBlocks('one\n\ntwo\n\n\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('keeps blank lines inside fenced code together', () => {
    const md = 'intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\noutro';
    expect(splitBlocks(md)).toEqual(['intro', '```ts\nconst a = 1;\n\nconst b = 2;\n```', 'outro']);
  });

  it('treats an unterminated fence (mid-stream) as one growing block', () => {
    expect(splitBlocks('text\n\n```py\nprint(1)\n\nprint(2)')).toEqual([
      'text',
      '```py\nprint(1)\n\nprint(2)',
    ]);
  });

  it('handles tilde fences and longer closing fences', () => {
    expect(splitBlocks('~~~\na\n\nb\n~~~~\n\nz')).toEqual(['~~~\na\n\nb\n~~~~', 'z']);
  });

  it('is stable as text grows, so earlier blocks keep identical strings', () => {
    const before = splitBlocks('first\n\nsecond par');
    const after = splitBlocks('first\n\nsecond paragraph\n\nthird');
    expect(after[0]).toBe(before[0]);
  });

  it('returns nothing for empty input', () => {
    expect(splitBlocks('')).toEqual([]);
  });
});
