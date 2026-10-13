import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { toSplitRows, type DiffFile, type DiffHunk, type DiffLine } from '../../lib/diff';
import type { DiffMode } from '../../stores/ui';

interface Props {
  files: DiffFile[];
  mode: DiffMode;
  wrap: boolean;
}

const SIGN = { add: '+', del: '-', ctx: ' ' } as const;

/** A line's text with the changed words emphasized. */
function LineText({ line }: { line: DiffLine }) {
  if (!line.segments) return <>{line.text || ' '}</>;
  const mark = line.kind === 'add' ? 'diff-word-add' : 'diff-word-del';
  return (
    <>
      {line.segments.map((s, i) =>
        s.changed ? (
          <mark key={i} className={mark}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

const num = (n: number | null) => (n === null ? '' : String(n));

function InlineHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      {hunk.lines.map((line, i) => (
        <div
          key={i}
          className={cn('diff-row diff-inline', line.kind !== 'ctx' && `diff-${line.kind}`)}
          data-kind={line.kind}
        >
          <span className="diff-no">{num(line.oldNo)}</span>
          <span className="diff-no">{num(line.newNo)}</span>
          <span className="diff-sign">{SIGN[line.kind]}</span>
          <span className="diff-cell">
            <LineText line={line} />
          </span>
        </div>
      ))}
    </>
  );
}

function SplitHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      {toSplitRows(hunk).map((row, i) => (
        <div key={i} className="diff-row diff-split">
          <span
            className={cn(
              'diff-no',
              row.left?.kind === 'del' && 'diff-del',
              !row.left && 'diff-empty',
            )}
          >
            {num(row.left?.oldNo ?? null)}
          </span>
          <span
            className={cn(
              'diff-cell',
              row.left?.kind === 'del' && 'diff-del',
              !row.left && 'diff-empty',
            )}
            data-kind={row.left?.kind ?? 'empty'}
          >
            {row.left && <LineText line={row.left} />}
          </span>
          <span
            className={cn(
              'diff-no',
              row.right?.kind === 'add' && 'diff-add',
              !row.right && 'diff-empty',
            )}
          >
            {num(row.right?.newNo ?? null)}
          </span>
          <span
            className={cn(
              'diff-cell',
              row.right?.kind === 'add' && 'diff-add',
              !row.right && 'diff-empty',
            )}
            data-kind={row.right?.kind ?? 'empty'}
          >
            {row.right && <LineText line={row.right} />}
          </span>
        </div>
      ))}
    </>
  );
}

/** Below this width two code columns are too cramped to read, so side-by-side falls back to inline. */
export const MIN_SPLIT_WIDTH = 520;

/** Width of an element in px (0 until measured, and in environments without layout). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry?.contentRect.width ?? 0)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Side-by-side or inline rendering of parsed diffs, with changed words highlighted.
 * A requested side-by-side layout is shown inline when the container is too narrow for it.
 */
export const DiffView = memo(function DiffView({ files, mode: requested, wrap }: Props) {
  const [ref, width] = useWidth();
  const narrow = requested === 'split' && width > 0 && width < MIN_SPLIT_WIDTH;
  const mode: DiffMode = narrow ? 'inline' : requested;
  return (
    <div
      ref={ref}
      className={cn('diff selectable', wrap ? 'diff-wrap' : 'overflow-x-auto')}
      data-mode={mode}
      data-requested={requested}
      title={narrow ? 'Too narrow for side-by-side here; showing inline' : undefined}
    >
      {files.length === 0 && (
        <p className="p-4 text-center text-xs text-fg-subtle">No differences.</p>
      )}
      <div className={wrap ? undefined : 'min-w-max'}>
        {files.map((file, f) => (
          <section key={f} data-testid="diff-file">
            <div className="diff-file-head">
              <span className="min-w-0 truncate">
                {file.oldName === file.newName || !file.oldName
                  ? file.newName || 'changes'
                  : `${file.oldName} → ${file.newName}`}
              </span>
              <span className="text-success">+{file.additions}</span>
              <span className="text-danger">−{file.deletions}</span>
            </div>
            {file.hunks.map((hunk, h) => (
              <div key={h}>
                {hunk.header && <div className="diff-hunk">{hunk.header}</div>}
                {mode === 'split' ? <SplitHunk hunk={hunk} /> : <InlineHunk hunk={hunk} />}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
});
