import { lazy, Suspense, useMemo } from 'react';
import { Markdown } from '../../components/chat/Markdown';
import { CodeLines } from '../../components/code/CodeLines';
import { useHighlighted } from '../../components/code/useHighlighted';
import { PreviewFrame } from '../../components/preview/PreviewFrame';
import { previewKind, previewTitle, type PreviewKind } from '../../lib/fence';
import type { PreviewTab } from '../../stores/preview';
import { useUiStore } from '../../stores/ui';
import type { FileEntry } from './files';

// The diff library is heavy, so it loads only when a diff is shown.
const FileDiff = lazy(() => import('./FileDiff'));

export type PaneMode = 'code' | 'diff' | 'preview';

/** Which previewer can render this file's code, if any. */
export function fileKind(file: FileEntry, code: string): PreviewKind | null {
  return previewKind({ language: file.language, label: file.label }, code);
}

interface Props {
  file: FileEntry;
  /** Index into file.versions. */
  index: number;
  mode: PaneMode;
}

/** One file version as code, as a diff against the version before it, or as a live preview. */
export function CodePane({ file, index, mode }: Props) {
  const version = file.versions[index];
  const wrap = useUiStore((s) => s.wrapCode);
  const code = version?.code ?? '';
  const tokens = useHighlighted(code, file.language);
  const kind = version ? fileKind(file, code) : null;

  const tab = useMemo<PreviewTab | null>(
    () =>
      kind && kind !== 'markdown'
        ? {
            id: `concept-${file.key}`,
            kind,
            title: previewTitle(kind, code),
            source: code,
            sourceKey: null,
            version: index + 1,
            logs: [],
          }
        : null,
    [kind, file.key, code, index],
  );

  if (!version) return <div className="p-4 text-fg-muted">No code yet.</div>;

  if (mode === 'preview' && kind) {
    if (kind === 'markdown') {
      return (
        <div className="selectable h-full overflow-auto p-5">
          <Markdown text={code} messageId={`concept-${file.key}-${index}`} />
        </div>
      );
    }
    return tab ? (
      <div className="flex h-full min-h-0 flex-col">
        <PreviewFrame key={`${tab.id}-${tab.version}`} tab={tab} />
      </div>
    ) : null;
  }

  if (mode === 'diff') {
    const before = index > 0 ? file.versions[index - 1] : undefined;
    if (!before) {
      return (
        <div className="grid h-full place-items-center p-6 text-center text-fg-muted">
          Version 1 has nothing earlier to compare with.
        </div>
      );
    }
    return (
      <Suspense fallback={<div className="p-4 text-fg-muted">Loading diff…</div>}>
        <FileDiff
          before={before.code}
          after={version.code}
          beforeName={`${file.name} v${before.n}`}
          afterName={`${file.name} v${version.n}`}
        />
      </Suspense>
    );
  }

  return (
    <div className="h-full overflow-auto bg-bg py-2">
      <CodeLines code={code} tokens={tokens} wrap={wrap} />
    </div>
  );
}
