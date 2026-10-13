import {
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Eye,
  GitCompare,
  GitCompareArrows,
  WrapText,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { findPreviousVersion } from '../../lib/code-blocks';
import { cn } from '../../lib/cn';
import {
  previewKind,
  previewTitle,
  suggestedFilename,
  type FenceInfo,
  type PreviewKind,
} from '../../lib/fence';
import { saveTextFile } from '../../lib/save-file';
import { previewStore, usePreview } from '../../stores/preview';
import { toast } from '../../stores/toast';
import { useUiStore } from '../../stores/ui';
import { useMarkdownContext } from '../chat/markdown-context';
import { Button } from '../ui/button';
import { CopyButton } from '../ui/copy-button';
import { CodeLines } from './CodeLines';
import { useConversationBlocks } from './useConversationBlocks';
import { useHighlighted } from './useHighlighted';

/** Blocks longer than this start collapsed (unless their reply is still streaming). */
export const COLLAPSE_AFTER_LINES = 28;
export const COLLAPSED_LINES = 16;

const KIND_LABEL: Record<PreviewKind, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Mermaid',
  markdown: 'Markdown',
};

interface Props {
  code: string;
  info: Pick<FenceInfo, 'label' | 'language' | 'filename'>;
  /** Stable id of this block: message id, block index and fence line. */
  blockKey: string;
}

const actionClass = 'size-6';

function openPanel() {
  useUiStore.getState().setRightPanelOpen(true);
}

export function CodeBlock({ code, info, blockKey }: Props) {
  const { messageId, streaming } = useMarkdownContext();
  const wrap = useUiStore((s) => s.wrapCode);
  const tokens = useHighlighted(code, info.language);

  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const collapsible = lineCount > COLLAPSE_AFTER_LINES;
  const collapsed = collapsible && (expanded === null ? !streaming : !expanded);

  const kind = previewKind(info, code);
  const title = info.filename ?? (kind ? KIND_LABEL[kind] : info.label || 'code');

  // --- live preview: a tab opened from this block follows it while the reply streams ---
  const tab = usePreview((s) => s.tabs.find((t) => t.sourceKey === blockKey));
  useEffect(() => {
    if (!tab || tab.source === code) return;
    const timer = setTimeout(() => previewStore.getState().updateSource(tab.id, code), 250);
    return () => clearTimeout(timer);
  }, [tab, code]);

  // --- compare: pick this block and another, or diff against an earlier version in the conversation ---
  const pending = usePreview((s) => s.compare);
  const blocks = useConversationBlocks();
  const settledCode = useDeferredValue(code);
  const previous = useMemo(
    () =>
      streaming
        ? null
        : findPreviousVersion(blocks, {
            messageId,
            language: info.language,
            filename: info.filename,
            code: settledCode,
          }),
    [blocks, messageId, info.language, info.filename, settledCode, streaming],
  );

  const onCompare = () => {
    const store = previewStore.getState();
    if (!pending) {
      store.startCompare({ key: blockKey, title, code });
      toast('Pick another code block to compare with');
    } else if (pending.key === blockKey) {
      store.cancelCompare();
    } else {
      store.openDiff({
        title: `${pending.title} → ${title}`,
        diff: {
          type: 'compare',
          before: pending.code,
          after: code,
          beforeName: pending.title,
          afterName: title,
        },
      });
      store.cancelCompare();
      openPanel();
    }
  };

  const onDiffPrevious = () => {
    if (!previous) return;
    const beforeName = previous.filename ?? `earlier ${previous.label || 'version'}`;
    previewStore.getState().openDiff({
      title: `${title} (changes)`,
      diff: { type: 'compare', before: previous.code, after: code, beforeName, afterName: title },
    });
    openPanel();
  };

  const onPreview = () => {
    if (!kind) return;
    previewStore.getState().open({
      kind,
      title: info.filename ?? previewTitle(kind, code),
      source: code,
      sourceKey: blockKey,
    });
    openPanel();
  };

  const onSave = async () => {
    try {
      if (await saveTextFile(suggestedFilename(info), code)) toast('Saved');
    } catch (err) {
      toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const comparing = pending?.key === blockKey;
  const compareTarget = pending && !comparing;

  return (
    <div
      className="code-block my-3 overflow-hidden rounded-panel border border-border bg-surface"
      data-testid="code-block"
    >
      <div className="flex h-8 items-center justify-between border-b border-border pr-1 pl-3 text-xs text-fg-subtle">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono">{info.label || 'text'}</span>
          {info.filename && (
            <span className="truncate font-mono text-fg-muted">{info.filename}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className={cn(actionClass, wrap && 'text-fg')}
            aria-label="Toggle line wrap"
            aria-pressed={wrap}
            title="Wrap long lines"
            onClick={() => useUiStore.getState().toggleWrapCode()}
          >
            <WrapText size={14} />
          </Button>
          {previous && (
            <Button
              variant="ghost"
              size="icon"
              className={actionClass}
              aria-label="Diff against earlier version"
              title="Diff against the earlier version in this conversation"
              onClick={onDiffPrevious}
            >
              <GitCompareArrows size={14} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(actionClass, (comparing || compareTarget) && 'text-accent')}
            aria-label={
              comparing
                ? 'Cancel comparison'
                : compareTarget
                  ? `Compare with ${pending.title}`
                  : 'Compare with another block'
            }
            aria-pressed={comparing}
            title={
              comparing
                ? 'Cancel comparison'
                : compareTarget
                  ? `Compare with “${pending.title}”`
                  : 'Compare with another code block'
            }
            onClick={onCompare}
          >
            <GitCompare size={14} />
          </Button>
          {kind && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(actionClass, tab && 'text-accent')}
              aria-label="Open in preview"
              title={`Open ${KIND_LABEL[kind]} in the preview panel`}
              onClick={onPreview}
            >
              <Eye size={14} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={actionClass}
            aria-label="Save as file"
            title="Save as file"
            onClick={() => void onSave()}
          >
            <Download size={14} />
          </Button>
          <CopyButton className={actionClass} label="Copy code" text={code} />
        </span>
      </div>

      <div className={cn('code-body', wrap ? '' : 'overflow-x-auto')}>
        <CodeLines
          code={code}
          tokens={tokens}
          wrap={wrap}
          {...(collapsed ? { maxLines: COLLAPSED_LINES } : {})}
        />
      </div>

      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded(collapsed)}
          className="flex h-7 w-full items-center justify-center gap-1.5 border-t border-border text-xs text-fg-muted hover:bg-hover hover:text-fg"
        >
          {collapsed ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
          {collapsed ? `Show ${lineCount - COLLAPSED_LINES} more lines` : 'Collapse'}
        </button>
      )}
    </div>
  );
}
