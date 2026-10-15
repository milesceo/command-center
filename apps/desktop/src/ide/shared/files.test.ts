import { describe, expect, it } from 'vitest';
import type { ConversationBlock } from '../../lib/code-blocks';
import { deriveFiles } from './files';

let line = 1;
const block = (
  messageId: string,
  code: string,
  extra: Partial<ConversationBlock> = {},
): ConversationBlock => ({
  messageId,
  code,
  label: 'ts',
  language: 'typescript',
  filename: null,
  line: line++,
  ...extra,
});

describe('deriveFiles', () => {
  it('versions a named file across replies', () => {
    const files = deriveFiles([
      block('m1', 'export const a = 1;', { filename: 'src/app.ts' }),
      block('m2', 'export const a = 2;', { filename: 'app.ts' }),
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(files[0]?.name).toBe('app.ts');
  });

  it('joins unnamed blocks that are mostly the same code', () => {
    const base = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'console.log(a, b, c);'];
    const files = deriveFiles([
      block('m1', base.join('\n')),
      block('m2', [...base, 'console.log("done");'].join('\n')),
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.versions).toHaveLength(2);
  });

  it('keeps unrelated blocks apart and numbers repeated names', () => {
    const files = deriveFiles([block('m1', 'alpha\nbeta\ngamma'), block('m2', 'one\ntwo\nthree')]);
    expect(files.map((f) => f.name)).toEqual(['ts', 'ts 2']);
  });

  it('ignores diffs and empty blocks, and does not version identical code', () => {
    const files = deriveFiles([
      block('m1', 'x = 1', { filename: 'a.py', language: 'python', label: 'py' }),
      block('m2', 'x = 1', { filename: 'a.py', language: 'python', label: 'py' }),
      block('m3', '--- a\n+++ b', { language: 'diff', label: 'diff' }),
      block('m4', '   ', { filename: 'b.py' }),
    ]);
    expect(files).toHaveLength(1);
    expect(files[0]?.versions).toHaveLength(1);
  });
});
