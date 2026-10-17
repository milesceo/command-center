import { BarChart3, BookText, Command, Keyboard, Plus, Settings } from 'lucide-react';
import { conversationsStore } from '../../stores/conversations';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';
import { BridgeStatus } from './BridgeStatus';
import { ConversationList } from './ConversationList';
import { ThemeToggle } from './ThemeToggle';
import { isMacPlatform, shortcutLabel } from '../../lib/shortcuts';

export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen);
  const view = useUiStore((s) => s.view);
  if (!open) return null;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="px-1 text-[13px] font-semibold tracking-tight">Command Center</span>
      </div>

      <div className="px-3 pb-2">
        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={() => {
            conversationsStore.getState().newChat();
            useUiStore.getState().setView('chat');
          }}
        >
          <Plus size={14} />
          New chat
        </Button>
      </div>

      <ConversationList />

      <nav aria-label="Library" className="flex flex-col gap-0.5 border-t border-border p-2">
        {(
          [
            ['prompts', 'Prompts', BookText],
            ['usage', 'Usage', BarChart3],
            ['settings', 'Settings', Settings],
          ] as const
        ).map(([id, label, Icon]) => (
          <Button
            key={id}
            variant="ghost"
            className="w-full justify-start"
            aria-current={view === id ? 'page' : undefined}
            onClick={() => useUiStore.getState().setView(view === id ? 'chat' : id)}
          >
            <Icon size={14} />
            {label}
          </Button>
        ))}
      </nav>

      <div className="flex items-center gap-1 border-t border-border p-2">
        <BridgeStatus />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Command palette"
          title={`Command palette (${shortcutLabel('Mod+K', isMacPlatform())})`}
          onClick={() => useUiStore.getState().setPaletteOpen(true)}
        >
          <Command size={15} />
        </Button>
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
