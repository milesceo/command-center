import { describe, expect, it } from 'vitest';
import {
  extractCodeBlocks,
  findPreviousVersion,
  similarity,
  type ConversationBlock,
} from './code-blocks';

describe('extractCodeBlocks', () => {
  it('finds blocks with language, file name and line', () => {
    const md =
      'intro\n\n```ts title="a.ts"\nconst a = 1;\n```\n\ntext\n\n~~~python\nprint(1)\n~~~\n';
    const blocks = extractCodeBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      language: 'typescript',
      filename: 'a.ts',
      code: 'const a = 1;',
      line: 3,
    });
    expect(blocks[1]).toMatchObject({ language: 'python', code: 'print(1)' });
  });

  it('does not close on a shorter or different fence', () => {
    const md = '````md\n```js\nx\n```\n````\n';
    const blocks = extractCodeBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.code).toBe('```js\nx\n```');
  });

  it('treats an unterminated fence as running to the end', () => {
    expect(extractCodeBlocks('```ts\nconst a')[0]?.code).toBe('const a');
  });

  it('returns nothing without fences', () => {
    expect(extractCodeBlocks('just text')).toEqual([]);
  });
});

describe('similarity', () => {
  it('compares sets of trimmed non-blank lines', () => {
    expect(similarity('a\nb\nc', 'a\nb\nd')).toBe(0.5);
    expect(similarity('  a  \n\n b', 'a\nb')).toBe(1);
    expect(similarity('', '')).toBe(1);
  });
});

const block = (
  messageId: string,
  code: string,
  over: Partial<ConversationBlock> = {},
): ConversationBlock => ({
  messageId,
  code,
  label: 'ts',
  language: 'typescript',
  filename: null,
  line: 1,
  ...over,
});

describe('findPreviousVersion', () => {
  const v1 = 'export function sum(a, b) {\n  return a + b;\n}\n\nexport const X = 1;';
  const v2 =
    'export function sum(a: number, b: number) {\n  return a + b;\n}\n\nexport const X = 1;';

  it('finds the most similar earlier block in the same language', () => {
    const blocks = [block('m1', v1), block('m2', 'const unrelated = 1;'), block('m3', v2)];
    const prev = findPreviousVersion(blocks, {
      messageId: 'm3',
      language: 'typescript',
      filename: null,
      code: v2,
    });
    expect(prev?.messageId).toBe('m1');
  });

  it('prefers a block with the same file name', () => {
    const blocks = [
      block('m1', 'x', { filename: 'src/a.ts' }),
      block('m2', v1),
      block('m3', 'y', { filename: 'lib/a.ts' }),
    ];
    const prev = findPreviousVersion(blocks, {
      messageId: 'm4',
      language: 'typescript',
      filename: 'a.ts',
      code: v2,
    });
    expect(prev?.messageId).toBe('m3');
  });

  it('ignores later blocks, identical blocks, other languages and dissimilar code', () => {
    const blocks = [
      block('m1', v2),
      block('m2', v1, { language: 'python' }),
      block('m3', 'totally different\ncode here'),
      block('m4', v1),
    ];
    expect(
      findPreviousVersion(blocks, {
        messageId: 'm2',
        language: 'typescript',
        filename: null,
        code: v2,
      }),
    ).toBeNull();
    expect(
      findPreviousVersion(blocks, {
        messageId: 'm3',
        language: 'typescript',
        filename: null,
        code: v2,
      }),
    ).toBeNull();
  });

  it('works for a message that is not stored yet (streaming)', () => {
    const prev = findPreviousVersion([block('m1', v1)], {
      messageId: 'new',
      language: 'typescript',
      filename: null,
      code: v2,
    });
    expect(prev?.messageId).toBe('m1');
  });

  it('needs a language to compare unnamed blocks', () => {
    expect(
      findPreviousVersion([block('m1', v1)], {
        messageId: 'x',
        language: '',
        filename: null,
        code: v2,
      }),
    ).toBeNull();
  });
});
