import { Lock, PanelBottom, PanelLeft, PanelRight, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { WindowControls } from '../components/shell/WindowControls';
import { isTauri } from '../lib/tauri';
import { cn } from '../lib/cn';
import { formatKeys, isMacPlatform } from '../lib/shortcuts';
import { toast } from '../stores/toast';
import { useConversations } from '../stores/conversations';
import { useIdeStore } from '../stores/ide';
import { useLockStore } from '../stores/lock';
import { useUiStore } from '../stores/ui';

/** Unified toolbar: app mark and sidebar toggle, a centered command pill, and layout toggles. */
export function TitleBar() {
  const mac = isMacPlatform();
  const title = useConversations(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.title ?? 'New thread',
  );
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const assistantOpen = useIdeStore((s) => s.assistantOpen);
  const bottomOpen = useIdeStore((s) => s.bottomOpen);
  const hasPin = useLockStore((s) => s.hasPin);

  const toggle = (active: boolean) => cn('size-7', active && 'bg-hover text-fg');

  return (
    <header data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-2 px-3">
      <div data-tauri-drag-region className="flex w-56 items-center gap-3">
        {!isTauri() && (
          <span className="px-1 font-mono text-[12px] font-semibold tracking-tight text-fg">
            command center
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={toggle(sidebarOpen)}
          aria-label="Toggle sidebar"
          aria-pressed={sidebarOpen}
          title={`Sidebar (${formatKeys('Mod+B', mac)})`}
          onClick={() => useUiStore.getState().toggleSidebar()}
        >
          <PanelLeft size={15} />
        </Button>
      </div>

      <button
        type="button"
        onClick={() => useUiStore.getState().setPaletteOpen(true)}
        className="mx-auto flex h-7 w-full max-w-[520px] items-center gap-2 rounded-control border border-border bg-surface px-2.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        aria-label="Open command palette"
      >
        <Search size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        <kbd className="rounded border border-border px-1 font-mono text-[10px] text-fg-subtle">
          {formatKeys('Mod+K', mac)}
        </kbd>
      </button>

      <div data-tauri-drag-region className="flex w-56 items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={toggle(bottomOpen)}
          aria-label="Toggle activity panel"
          aria-pressed={bottomOpen}
          title="Activity panel (Ctrl+J)"
          onClick={() => useIdeStore.getState().toggleBottom()}
        >
          <PanelBottom size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={toggle(assistantOpen)}
          aria-label="Toggle assistant"
          aria-pressed={assistantOpen}
          title="Assistant (Ctrl+Shift+A)"
          onClick={() => useIdeStore.getState().toggleAssistant()}
        >
          <PanelRight size={15} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Lock Command Center"
          title={hasPin ? 'Lock (Ctrl+L)' : 'Set a PIN in Settings to enable the lock'}
          onClick={() => {
            if (hasPin) useLockStore.getState().lock();
            else {
              toast('Set a PIN in Settings to use the lock');
              useUiStore.getState().setView('settings');
            }
          }}
        >
          <Lock size={14} />
        </Button>
        <WindowControls className="ml-3 pr-1" />
      </div>
    </header>
  );
}
