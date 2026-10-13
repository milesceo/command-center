import { Plus } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';
import { BridgeStatus } from './BridgeStatus';
import { ThemeToggle } from './ThemeToggle';

export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen);
  if (!open) return null;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="px-1 text-[13px] font-semibold tracking-tight">Programish</span>
      </div>

      <div className="px-3 pb-2">
        <Button variant="secondary" className="w-full justify-start" disabled>
          <Plus size={14} />
          New chat
        </Button>
      </div>

      <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-3 py-2">
        <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
          Recent
        </p>
        <p className="px-1 text-xs text-fg-subtle">No conversations yet.</p>
      </nav>

      <div className="flex items-center gap-1 border-t border-border p-2">
        <BridgeStatus />
        <ThemeToggle />
      </div>
    </aside>
  );
}
