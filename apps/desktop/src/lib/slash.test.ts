import { describe, expect, it } from 'vitest';
import { applyInsertion, findSlashQuery } from './slash';

describe('findSlashQuery', () => {
  it('opens at the start of the composer and on any line start', () => {
    expect(findSlashQuery('/', 1)).toEqual({ start: 0, query: '' });
    expect(findSlashQuery('/rev', 4)).toEqual({ start: 0, query: 'rev' });
    expect(findSlashQuery('hello\n/ex', 9)).toEqual({ start: 6, query: 'ex' });
  });

  it('uses only the text before the caret', () => {
    expect(findSlashQuery('/review more', 4)).toEqual({ start: 0, query: 'rev' });
  });

  it('does not open mid-line, after a space, or for paths', () => {
    expect(findSlashQuery('look at src/a', 13)).toBeNull();
    expect(findSlashQuery('/review code', 12)).toBeNull();
    expect(findSlashQuery('plain', 5)).toBeNull();
    expect(findSlashQuery('', 0)).toBeNull();
    expect(findSlashQuery('a /b', 4)).toBeNull();
  });
});

describe('applyInsertion', () => {
  it('replaces the slash token and puts the caret after the insertion', () => {
    expect(applyInsertion('/rev', 0, 4, 'Review this')).toEqual({ text: 'Review this', caret: 11 });
    expect(applyInsertion('intro\n/ex tail', 6, 9, 'Explain')).toEqual({
      text: 'intro\nExplain tail',
      caret: 13,
    });
  });
});
