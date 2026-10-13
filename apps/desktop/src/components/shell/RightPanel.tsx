import { X } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';

/** Reserved for rendered previews, diffs and artifacts in later phases. */
export function RightPanel() {
  const { rightPanelOpen, toggleRightPanel } = useUiStore();
  if (!rightPanelOpen) return null;

  return (
    <aside
      aria-label="Preview"
      className="flex w-96 shrink-0 flex-col border-l border-border bg-surface"
    >
      <header className="flex h-11 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-medium">Preview</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close preview panel"
          onClick={toggleRightPanel}
        >
          <X size={14} />
        </Button>
      </header>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-fg-subtle">
        Code previews, diffs and rendered output will appear here.
      </div>
    </aside>
  );
}
