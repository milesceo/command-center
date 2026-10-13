import { describe, expect, it } from 'vitest';
import { toNumberedParams } from './db';

describe('toNumberedParams', () => {
  it('numbers placeholders in order', () => {
    expect(toNumberedParams('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
  });

  it('leaves question marks inside quoted strings alone', () => {
    expect(toNumberedParams('SELECT \'?\' AS q, "a?b" FROM t WHERE x = ?')).toBe(
      'SELECT \'?\' AS q, "a?b" FROM t WHERE x = $1',
    );
  });

  it('handles the escape clause used by search queries', () => {
    expect(toNumberedParams("title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'")).toBe(
      "title LIKE $1 ESCAPE '\\' OR body LIKE $2 ESCAPE '\\'",
    );
  });

  it('returns statements without placeholders unchanged', () => {
    expect(toNumberedParams('SELECT 1')).toBe('SELECT 1');
  });
});
