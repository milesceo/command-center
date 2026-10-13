import { Eye, Monitor, RefreshCw, Smartphone, SquareTerminal, Tablet, X } from 'lucide-react';
import { lazy, Suspense, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../../lib/cn';
import { previewStore, usePreview, type PreviewTab, type ViewportSize } from '../../stores/preview';
import { useUiStore } from '../../stores/ui';
import { Markdown } from '../chat/Markdown';
import { DiffModeToggle } from '../code/DiffToolbar';
import { Button } from '../ui/button';
import { ConsolePane } from './ConsolePane';
import { PreviewFrame } from './PreviewFrame';

const DiffTab = lazy(() => import('./DiffTab'));

const VIEWPORTS: { id: ViewportSize; label: string; icon: typeof Monitor }[] = [
  { id: 'mobile', label: 'Mobile (375px)', icon: Smartphone },
  { id: 'tablet', label: 'Tablet (768px)', icon: Tablet },
  { id: 'desktop', label: 'Desktop (full width)', icon: Monitor },
];

function Empty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-xs text-fg-subtle">
      <Eye size={18} />
      <p>
        Open an HTML, SVG, Mermaid or Markdown code block here with its{' '}
        <span className="text-fg-muted">eye</span> button, or compare two code blocks to see a diff.
      </p>
    </div>
  );
}

function TabBody({ tab }: { tab: PreviewTab }) {
  if (tab.kind === 'diff' && tab.diff) {
    return (
      <Suspense fallback={<p className="p-4 text-xs text-fg-subtle">Loading diff…</p>}>
        <DiffTab diff={tab.diff} />
      </Suspense>
    );
  }
  if (tab.kind === 'markdown') {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <Markdown text={tab.source} messageId={`preview-${tab.id}`} />
      </div>
    );
  }
  return <PreviewFrame tab={tab} />;
}

/** Drag handle on the panel's left edge. */
function ResizeHandle() {
  const setWidth = useUiStore((s) => s.setRightPanelWidth);
  const dragging = useRef(false);
  const onDown = (e: ReactPointerEvent) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (dragging.current) setWidth(window.innerWidth - e.clientX);
  };
  const onUp = (e: ReactPointerEvent) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview panel"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/30"
    />
  );
}

/** The right panel: tabs for code previews and diffs. */
export function PreviewPanel() {
  const { tabs, activeId, viewport, consoleOpen } = usePreview((s) => s);
  const width = useUiStore((s) => s.rightPanelWidth);
  const close = useUiStore((s) => s.setRightPanelOpen);
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const store = previewStore.getState();
  const runnable =
    active && (active.kind === 'html' || active.kind === 'svg' || active.kind === 'mermaid');
  const errors = active?.logs.filter((l) => l.level === 'error').length ?? 0;

  return (
    <aside
      aria-label="Preview"
      className="relative flex shrink-0 flex-col border-l border-border bg-surface"
      style={{ width }}
    >
      <ResizeHandle />
      <header className="flex h-11 shrink-0 items-center border-b border-border pr-1">
        <div
          role="tablist"
          aria-label="Previews"
          className="flex min-w-0 flex-1 items-end self-stretch overflow-x-auto"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={cn(
                'group flex shrink-0 items-center border-r border-border',
                tab.id === activeId ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-hover',
              )}
            >
              <button
                role="tab"
                type="button"
                aria-selected={tab.id === activeId}
                onClick={() => store.activate(tab.id)}
                className="flex h-11 max-w-40 items-center gap-1.5 pr-1 pl-3 text-xs"
              >
                <span className="truncate">{tab.title}</span>
                {tab.logs.some((l) => l.level === 'error') && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-danger"
                    aria-label="has errors"
                  />
                )}
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                className="mr-1 rounded p-1 text-fg-subtle hover:bg-hover hover:text-fg"
                onClick={() => store.close(tab.id)}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {tabs.length === 0 && <span className="px-3 text-xs font-medium">Preview</span>}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close preview panel"
          onClick={() => close(false)}
        >
          <X size={14} />
        </Button>
      </header>

      {active && (
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
          <span className="flex items-center gap-1">
            {runnable && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Refresh preview"
                title="Re-run"
                onClick={() => store.refresh(active.id)}
              >
                <RefreshCw size={13} />
              </Button>
            )}
            {active.kind === 'diff' && <DiffModeToggle />}
          </span>
          {runnable && (
            <span className="flex items-center gap-1">
              <span role="group" aria-label="Viewport width" className="flex items-center">
                {VIEWPORTS.map(({ id, label, icon: Icon }) => (
                  <Button
                    key={id}
                    variant="ghost"
                    size="icon"
                    className={cn('size-6', viewport === id && 'bg-hover text-fg')}
                    aria-label={label}
                    aria-pressed={viewport === id}
                    title={label}
                    onClick={() => store.setViewport(id)}
                  >
                    <Icon size={13} />
                  </Button>
                ))}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className={cn('relative size-6', consoleOpen && 'bg-hover text-fg')}
                aria-label="Toggle console"
                aria-pressed={consoleOpen}
                title="Console"
                onClick={() => store.setConsoleOpen(!consoleOpen)}
              >
                <SquareTerminal size={13} />
                {errors > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-danger" />
                )}
              </Button>
            </span>
          )}
        </div>
      )}

      {active ? <TabBody key={active.id} tab={active} /> : <Empty />}
      {active && runnable && consoleOpen && <ConsolePane tab={active} />}
    </aside>
  );
}
