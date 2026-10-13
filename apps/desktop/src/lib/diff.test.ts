import { describe, expect, it } from 'vitest';
import { diffFromTexts, parseUnifiedDiff, toSplitRows, wordSegments } from './diff';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,4 @@
 const a = 1;
-const total = a + b;
+const total = a + b + c;
 const z = 3;
 export {};
`;

describe('parseUnifiedDiff', () => {
  it('parses a git diff with numbering and stats', () => {
    const [file] = parseUnifiedDiff(PATCH);
    expect(file).toMatchObject({
      oldName: 'src/a.ts',
      newName: 'src/a.ts',
      additions: 1,
      deletions: 1,
    });
    const lines = file?.hunks[0]?.lines ?? [];
    expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['ctx', 1, 1],
      ['del', 2, null],
      ['add', null, 2],
      ['ctx', 3, 3],
      ['ctx', 4, 4],
    ]);
  });

  it('highlights only the changed words of a modified line', () => {
    const lines = parseUnifiedDiff(PATCH)[0]?.hunks[0]?.lines ?? [];
    const added = lines.find((l) => l.kind === 'add');
    expect(added?.segments?.filter((s) => s.changed).map((s) => s.text.trim())).toEqual(['+ c']);
    expect(added?.segments?.map((s) => s.text).join('')).toBe('const total = a + b + c;');
  });

  it('survives wrong hunk counts and missing context spaces', () => {
    const [file] = parseUnifiedDiff(
      '--- a/x\n+++ b/x\n@@ -1,99 +1,99 @@\nkeep\n-old\n+new\n\n tail',
    );
    expect(file?.hunks[0]?.lines.map((l) => [l.kind, l.text])).toEqual([
      ['ctx', 'keep'],
      ['del', 'old'],
      ['add', 'new'],
      ['ctx', ''],
      ['ctx', 'tail'],
    ]);
  });

  it('accepts a bare list of +/- lines without headers or numbers', () => {
    const [file] = parseUnifiedDiff('-const a = 1;\n+const a = 2;\n unchanged');
    expect(file?.hunks[0]?.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['del', null, null],
      ['add', null, null],
      ['ctx', null, null],
    ]);
  });

  it('splits multiple files and hunks', () => {
    const files = parseUnifiedDiff(
      `${PATCH}diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n@@ -10 +10 @@\n-p\n+q\n`,
    );
    expect(files.map((f) => f.newName)).toEqual(['src/a.ts', 'b.ts']);
    expect(files[1]?.hunks).toHaveLength(2);
  });

  it('keeps a removed line that begins with dashes (not a file header)', () => {
    const [file] = parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1,2 +1,1 @@\n--- a comment\n keep');
    expect(file?.hunks[0]?.lines[0]).toMatchObject({ kind: 'del', text: '-- a comment' });
  });

  it('ignores "no newline" markers and returns nothing for non-diffs', () => {
    expect(
      parseUnifiedDiff('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b')[0]?.hunks[0]?.lines,
    ).toHaveLength(2);
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('diffFromTexts', () => {
  it('diffs two texts with context and stats', () => {
    const [file] = diffFromTexts('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nX\ne\nf\ng\nh', {
      oldName: 'v1',
      newName: 'v2',
      context: 2,
    });
    expect(file).toMatchObject({ oldName: 'v1', newName: 'v2', additions: 1, deletions: 1 });
    expect(file?.hunks[0]?.lines.map((l) => l.kind)).toEqual([
      'ctx',
      'ctx',
      'del',
      'add',
      'ctx',
      'ctx',
    ]);
  });

  it('returns no files when the texts are equal', () => {
    expect(diffFromTexts('same', 'same')).toEqual([]);
  });
});

describe('wordSegments', () => {
  it('marks only the differing words', () => {
    const s = wordSegments('let x = foo(1)', 'let x = bar(1)');
    expect(s?.old.filter((p) => p.changed).map((p) => p.text)).toEqual(['foo']);
    expect(s?.new.filter((p) => p.changed).map((p) => p.text)).toEqual(['bar']);
  });
  it('declines when the lines have little in common', () => {
    expect(wordSegments('completely different text here', 'xyz')).toBeNull();
  });
});

describe('toSplitRows', () => {
  it('pairs removed and added lines and pads uneven runs', () => {
    const [file] = parseUnifiedDiff('@@ -1,3 +1,4 @@\n ctx\n-a\n-b\n+A\n+B\n+C\n ctx2');
    const rows = toSplitRows(file!.hunks[0]!);
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['ctx', 'ctx'],
      ['a', 'A'],
      ['b', 'B'],
      [null, 'C'],
      ['ctx2', 'ctx2'],
    ]);
  });
  it('handles a removal with no replacement and an addition with no removal', () => {
    const rows = toSplitRows(parseUnifiedDiff('@@ -1,2 +1,2 @@\n-gone\n ctx\n+new')[0]!.hunks[0]!);
    expect(rows.map((r) => [r.left?.kind ?? null, r.right?.kind ?? null])).toEqual([
      ['del', null],
      ['ctx', 'ctx'],
      [null, 'add'],
    ]);
  });
});
