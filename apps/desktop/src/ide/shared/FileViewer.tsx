import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { CopyButton } from '../../components/ui/copy-button';
import { Segmented } from '../../components/ui/segmented';
import { suggestedFilename } from '../../lib/fence';
import { saveTextFile } from '../../lib/save-file';
import { toast } from '../../stores/toast';
import { CodePane, fileKind, type PaneMode } from './CodePane';
import type { FileEntry } from './files';

interface Props {
  file: FileEntry;
  /** Hides the file name (a surrounding tab strip already shows it). */
  compact?: boolean;
}

/**
 * A file with its version history: step through versions, switch between code,
 * diff-against-previous and live preview. Follows the newest version until the
 * user steps back, so a reply that rewrites the file shows up immediately.
 */
export function FileViewer({ file, compact = false }: Props) {
  const [pinned, setPinned] = useState<number | null>(null);
  const [mode, setMode] = useState<PaneMode>('code');

  const last = file.versions.length - 1;
  const index = Math.min(pinned ?? last, last);
  const version = file.versions[index];
  const canDiff = index > 0;
  const canPreview = version ? fileKind(file, version.code) !== null : false;
  const effective: PaneMode =
    mode === 'diff' && !canDiff ? 'code' : mode === 'preview' && !canPreview ? 'code' : mode;

  const step = (delta: number) => {
    const next = Math.max(0, Math.min(last, index + delta));
    setPinned(next === last ? null : next);
  };

  const save = async () => {
    if (!version) return;
    const name = suggestedFilename({
      language: file.language,
      label: file.label,
      filename: file.filename,
    });
    try {
      toast((await saveTextFile(name, version.code)) ? `Saved ${name}` : 'Save cancelled');
    } catch {
      toast('Could not save the file');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="file-viewer">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {!compact && (
          <span className="min-w-0 truncate text-[13px] font-medium" title={file.name}>
            {file.name}
          </span>
        )}
        <span className="flex items-center gap-0.5 text-xs text-fg-muted tabular-nums">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Previous version"
            disabled={index === 0}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={13} />
          </Button>
          <span aria-live="polite">
            v{version?.n ?? 0}/{file.versions.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Next version"
            disabled={index === last}
            onClick={() => step(1)}
          >
            <ChevronRight size={13} />
          </Button>
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Segmented
            label="View"
            value={effective}
            onChange={(next) => {
              if (next === 'diff' && !canDiff) return;
              if (next === 'preview' && !canPreview) return;
              setMode(next);
            }}
            options={[
              { value: 'code', label: 'Code' },
              { value: 'diff', label: canDiff ? 'Diff' : 'Diff –' },
              { value: 'preview', label: canPreview ? 'Preview' : 'Preview –' },
            ]}
          />
          <CopyButton text={version?.code ?? ''} label="Copy this version" className="size-6" />
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Save this version as a file"
            title="Save as file"
            onClick={() => void save()}
          >
            <Download size={14} />
          </Button>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <CodePane file={file} index={index} mode={effective} />
      </div>
    </div>
  );
}
