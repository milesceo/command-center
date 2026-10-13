import { Keyboard, Plus } from 'lucide-react';
import { conversationsStore } from '../../stores/conversations';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';
import { BridgeStatus } from './BridgeStatus';
import { ConversationList } from './ConversationList';
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
        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={() => conversationsStore.getState().newChat()}
        >
          <Plus size={14} />
          New chat
        </Button>
      </div>

      <ConversationList />

      <div className="flex items-center gap-1 border-t border-border p-2">
        <BridgeStatus />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={() => useUiStore.getState().setShortcutsOpen(true)}
        >
          <Keyboard size={15} />
        </Button>
        <ThemeToggle />
      </div>
    </aside>
  );
}
