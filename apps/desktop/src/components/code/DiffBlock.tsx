import { Download, Eye } from 'lucide-react';
import { useMemo } from 'react';
import { parseUnifiedDiff } from '../../lib/diff';
import { saveTextFile } from '../../lib/save-file';
import { previewStore } from '../../stores/preview';
import { toast } from '../../stores/toast';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';
import { CopyButton } from '../ui/copy-button';
import { DiffView } from './DiffView';
import { DiffModeToggle } from './DiffToolbar';

interface Props {
  code: string;
  filename: string | null;
  blockKey: string;
}

/** A unified diff found in a reply, rendered as a diff instead of plain code. Loaded lazily (it pulls in the diff library). */
export default function DiffBlock({ code, filename, blockKey }: Props) {
  const mode = useUiStore((s) => s.diffMode);
  const wrap = useUiStore((s) => s.wrapCode);
  const files = useMemo(() => parseUnifiedDiff(code), [code]);
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);

  const openInPanel = () => {
    previewStore.getState().openDiff({
      title: filename ?? 'diff',
      diff: { type: 'patch', patch: code },
      sourceKey: blockKey,
    });
    useUiStore.getState().setRightPanelOpen(true);
  };
  const save = async () => {
    try {
      if (await saveTextFile(filename ?? 'changes.diff', code)) toast('Saved');
    } catch (err) {
      toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div
      className="my-3 overflow-hidden rounded-panel border border-border bg-surface"
      data-testid="diff-block"
    >
      <div className="flex h-8 items-center justify-between border-b border-border pr-1 pl-3 text-xs text-fg-subtle">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono">diff</span>
          {filename && <span className="truncate font-mono text-fg-muted">{filename}</span>}
          <span className="text-success">+{additions}</span>
          <span className="text-danger">−{deletions}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <DiffModeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Open diff in preview panel"
            title="Open in the preview panel"
            onClick={openInPanel}
          >
            <Eye size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Save as file"
            title="Save as .diff"
            onClick={() => void save()}
          >
            <Download size={14} />
          </Button>
          <CopyButton className="size-6" label="Copy diff" text={code} />
        </span>
      </div>
      <DiffView files={files} mode={mode} wrap={wrap} />
    </div>
  );
}
