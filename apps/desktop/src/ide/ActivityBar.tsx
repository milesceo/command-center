import { BarChart3, BookText, Files, Settings, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { useUiStore, type View } from '../stores/ui';

interface Item {
  id: 'explorer' | Exclude<View, 'chat'>;
  label: string;
  icon: LucideIcon;
}

const TOP: Item[] = [
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'prompts', label: 'Prompt library', icon: BookText },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
];
const BOTTOM: Item[] = [{ id: 'settings', label: 'Settings', icon: Settings }];

/** Narrow icon rail: Explorer toggles the sidebar, the others open a view in the editor area. */
export function ActivityBar() {
  const view = useUiStore((s) => s.view);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);

  const press = (item: Item) => {
    const ui = useUiStore.getState();
    if (item.id === 'explorer') {
      // Selecting Explorer from another view returns to the editor; pressing it again hides the sidebar.
      if (ui.view !== 'chat') ui.setView('chat');
      else ui.toggleSidebar();
      return;
    }
    ui.setView(ui.view === item.id ? 'chat' : item.id);
  };

  const active = (item: Item) =>
    item.id === 'explorer' ? view === 'chat' && sidebarOpen : view === item.id;

  const render = (item: Item) => (
    <button
      key={item.id}
      type="button"
      title={item.label}
      aria-label={item.label}
      aria-pressed={active(item)}
      onClick={() => press(item)}
      className={cn(
        'relative grid size-9 place-items-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg',
        active(item) && 'bg-hover text-fg',
      )}
    >
      {active(item) && (
        <span className="absolute top-2 -left-[7px] h-5 w-0.5 rounded-full bg-accent" />
      )}
      <item.icon size={17} strokeWidth={1.75} />
    </button>
  );

  return (
    <nav
      aria-label="Activity"
      className="flex w-11 shrink-0 flex-col items-center justify-between py-1"
    >
      <div className="flex flex-col gap-1">{TOP.map(render)}</div>
      <div className="flex flex-col gap-1">{BOTTOM.map(render)}</div>
    </nav>
  );
}
