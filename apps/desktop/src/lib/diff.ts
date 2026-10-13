import { createTwoFilesPatch, diffWordsWithSpace } from 'diff';

/** Structured diff model shared by the inline and side-by-side views. */

export type LineKind = 'add' | 'del' | 'ctx';

export interface Segment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: LineKind;
  /** Line numbers; null on the side where the line does not exist, or when the diff carries none. */
  oldNo: number | null;
  newNo: number | null;
  text: string;
  /** Word-level breakdown for changed lines that have a close counterpart. */
  segments?: Segment[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldName: string;
  newName: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
const stripPrefix = (name: string) =>
  name
    .replace(/^[ab]\//, '')
    .replace(/\t.*$/, '')
    .trim();

/**
 * Parses a unified diff leniently. Diffs written by a language model often have
 * wrong hunk counts, missing context spaces or no `@@` headers at all, so line
 * numbers are tracked from the hunk start rather than trusted from the counts,
 * and a bare list of `+`/`-` lines is accepted.
 */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo: number | null = null;
  let newNo: number | null = null;

  const startFile = (oldName = '', newName = '') => {
    file = { oldName, newName, hunks: [], additions: 0, deletions: 0 };
    files.push(file);
    hunk = null;
    return file;
  };
  const ensureHunk = () => {
    const f = file ?? startFile();
    if (!hunk) {
      hunk = { header: '', lines: [] };
      f.hunks.push(hunk);
      // No `@@` header means no trustworthy numbering.
      oldNo = null;
      newNo = null;
    }
    return hunk;
  };

  const lines = patch.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      startFile(m?.[1] ?? '', m?.[2] ?? '');
      continue;
    }
    // Inside a hunk, `--- x` / `+++ y` is a header only when a hunk header follows; otherwise it is
    // a removed line starting with `-- ` followed by an added line starting with `++ `.
    const isHeaderPair =
      line.startsWith('--- ') &&
      (lines[i + 1] ?? '').startsWith('+++ ') &&
      (hunk === null || (lines[i + 2] ?? '').startsWith('@@'));
    if (isHeaderPair) {
      const prev = file as DiffFile | null;
      // Reuse the file started by `diff --git` when it has no hunks yet.
      const target = prev && prev.hunks.length === 0 ? prev : startFile();
      target.oldName = stripPrefix(line.slice(4));
      target.newName = stripPrefix((lines[i + 1] as string).slice(4));
      file = target;
      hunk = null;
      i++;
      continue;
    }
    const header = HUNK.exec(line);
    if (header) {
      const f = file ?? startFile();
      hunk = { header: line, lines: [] };
      f.hunks.push(hunk);
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      continue;
    }
    // Metadata and blank lines between a file header and its first hunk.
    if (
      !hunk &&
      (line.trim() === '' ||
        /^(index |Index: |={4,}|new file mode|deleted file mode|old mode|new mode|similarity |rename |Binary files )/.test(
          line,
        ))
    ) {
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    const current = ensureHunk();
    const target = file as unknown as DiffFile;
    const marker = line[0];
    if (marker === '+') {
      current.lines.push({ kind: 'add', oldNo: null, newNo, text: line.slice(1) });
      target.additions++;
      if (newNo !== null) newNo++;
    } else if (marker === '-') {
      current.lines.push({ kind: 'del', oldNo, newNo: null, text: line.slice(1) });
      target.deletions++;
      if (oldNo !== null) oldNo++;
    } else {
      // Context. Tolerate a missing leading space (and empty lines).
      current.lines.push({
        kind: 'ctx',
        oldNo,
        newNo,
        text: marker === ' ' ? line.slice(1) : line,
      });
      if (oldNo !== null) oldNo++;
      if (newNo !== null) newNo++;
    }
  }

  for (const f of files) for (const h of f.hunks) annotateWords(h);
  return files.filter((f) => f.hunks.some((h) => h.lines.length > 0));
}

/** Below this share of unchanged text, word highlights are noise: mark the whole line instead. */
const MIN_COMMON_RATIO = 0.35;

/** Word-level segments for one removed/added pair, or null when the lines are too different. */
export function wordSegments(
  oldText: string,
  newText: string,
): { old: Segment[]; new: Segment[] } | null {
  const parts = diffWordsWithSpace(oldText, newText);
  const oldSegs: Segment[] = [];
  const newSegs: Segment[] = [];
  let common = 0;
  for (const part of parts) {
    if (part.added) newSegs.push({ text: part.value, changed: true });
    else if (part.removed) oldSegs.push({ text: part.value, changed: true });
    else {
      common += part.value.length;
      oldSegs.push({ text: part.value, changed: false });
      newSegs.push({ text: part.value, changed: false });
    }
  }
  const longest = Math.max(oldText.length, newText.length);
  if (longest === 0 || common / longest < MIN_COMMON_RATIO) return null;
  return { old: oldSegs, new: newSegs };
}

/** Pairs each run of removed lines with the added lines that follow and marks changed words. */
function annotateWords(hunk: DiffHunk): void {
  const { lines } = hunk;
  for (let i = 0; i < lines.length;) {
    if ((lines[i] as DiffLine).kind !== 'del') {
      i++;
      continue;
    }
    let delEnd = i;
    while (delEnd < lines.length && (lines[delEnd] as DiffLine).kind === 'del') delEnd++;
    let addEnd = delEnd;
    while (addEnd < lines.length && (lines[addEnd] as DiffLine).kind === 'add') addEnd++;
    const pairs = Math.min(delEnd - i, addEnd - delEnd);
    for (let k = 0; k < pairs; k++) {
      const del = lines[i + k] as DiffLine;
      const add = lines[delEnd + k] as DiffLine;
      const segments = wordSegments(del.text, add.text);
      if (segments) {
        del.segments = segments.old;
        add.segments = segments.new;
      }
    }
    i = addEnd;
  }
}

/** Unified diff between two texts, as the same model the patch parser produces. */
export function diffFromTexts(
  oldText: string,
  newText: string,
  names: { oldName?: string; newName?: string; context?: number } = {},
): DiffFile[] {
  const patch = createTwoFilesPatch(
    names.oldName ?? 'before',
    names.newName ?? 'after',
    oldText,
    newText,
    '',
    '',
    {
      context: names.context ?? 3,
    },
  );
  return parseUnifiedDiff(patch);
}

/** Rows for the side-by-side view: context on both sides, change runs paired index by index. */
export function toSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const { lines } = hunk;
  for (let i = 0; i < lines.length;) {
    const line = lines[i] as DiffLine;
    if (line.kind === 'ctx') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && (lines[i] as DiffLine).kind === 'del')
      dels.push(lines[i++] as DiffLine);
    while (i < lines.length && (lines[i] as DiffLine).kind === 'add')
      adds.push(lines[i++] as DiffLine);
    if (dels.length === 0 && adds.length === 0) {
      // An `add` before any `del` (adds-first ordering) forms its own run.
      adds.push(lines[i++] as DiffLine);
    }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
    }
  }
  return rows;
}

/** Patch text of a parsed file (for copying). */
export function patchText(file: DiffFile): string {
  const out = [`--- ${file.oldName}`, `+++ ${file.newName}`];
  for (const hunk of file.hunks) {
    if (hunk.header) out.push(hunk.header);
    for (const l of hunk.lines)
      out.push(`${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`);
  }
  return out.join('\n');
}
