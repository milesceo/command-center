import { Eraser } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import type { ConsoleLevel } from '../../lib/preview-doc';
import { previewStore, type PreviewTab } from '../../stores/preview';
import { Button } from '../ui/button';

const COLOR: Record<ConsoleLevel, string> = {
  log: 'text-fg',
  info: 'text-accent',
  debug: 'text-fg-subtle',
  warn: 'text-warning',
  error: 'text-danger',
};

/** Output and uncaught errors from the previewed page. */
export function ConsolePane({ tab }: { tab: PreviewTab }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Follow new output.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab.logs.length]);

  return (
    <section
      aria-label="Preview console"
      className="flex h-40 shrink-0 flex-col border-t border-border bg-surface"
    >
      <header className="flex h-7 items-center justify-between border-b border-border pr-1 pl-3 text-xs text-fg-muted">
        <span>Console</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Clear console"
          title="Clear"
          onClick={() => previewStore.getState().clearLogs(tab.id)}
        >
          <Eraser size={12} />
        </Button>
      </header>
      <div
        ref={scroller}
        className="selectable min-h-0 flex-1 overflow-auto px-3 py-1 font-mono text-xs"
        role="log"
      >
        {tab.logs.length === 0 && <p className="text-fg-subtle">No output.</p>}
        {tab.logs.map((entry, i) => (
          <div
            key={i}
            className={cn(
              'whitespace-pre-wrap break-words border-b border-border/50 py-0.5',
              COLOR[entry.level],
            )}
            data-level={entry.level}
          >
            {entry.level === 'warn' || entry.level === 'error' ? `${entry.level}: ` : ''}
            {entry.text}
          </div>
        ))}
      </div>
    </section>
  );
}
