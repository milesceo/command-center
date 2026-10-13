import { Columns2, Rows2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';

/** Side-by-side / inline switch; the choice is shared by every diff in the app. */
export function DiffModeToggle() {
  const mode = useUiStore((s) => s.diffMode);
  const set = useUiStore((s) => s.setDiffMode);
  return (
    <span
      className="flex items-center rounded-control border border-border"
      role="group"
      aria-label="Diff layout"
    >
      <Button
        variant="ghost"
        size="icon"
        className={cn('size-6 rounded-r-none', mode === 'split' && 'bg-hover text-fg')}
        aria-label="Side-by-side diff"
        aria-pressed={mode === 'split'}
        title="Side by side"
        onClick={() => set('split')}
      >
        <Columns2 size={13} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn('size-6 rounded-l-none', mode === 'inline' && 'bg-hover text-fg')}
        aria-label="Inline diff"
        aria-pressed={mode === 'inline'}
        title="Inline"
        onClick={() => set('inline')}
      >
        <Rows2 size={13} />
      </Button>
    </span>
  );
}
