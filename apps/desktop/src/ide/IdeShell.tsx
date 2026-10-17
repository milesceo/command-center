import { useEffect } from 'react';
import { toast } from '../stores/toast';
import { conversationsStore } from '../stores/conversations';
import { useIdeStore } from '../stores/ide';
import { useLockStore } from '../stores/lock';
import { useUiStore } from '../stores/ui';
import { ActivityBar } from './ActivityBar';
import { AssistantPanel } from './AssistantPanel';
import { BottomPanel } from './BottomPanel';
import { EditorArea } from './EditorArea';
import { Explorer } from './Explorer';
import { ResizeHandle } from './ResizeHandle';
import { Hud } from './shared/Hud';
import { TitleBar } from './TitleBar';
import { isMacPlatform } from '../lib/shortcuts';

/** Window padding and status bar height, used to turn pointer positions into pane sizes. */
const GUTTER = 8;
const STATUS_BAR = 28;

/**
 * Concept: an editor for conversations. Floating, rounded panes on a dark canvas in the
 * manner of a macOS app: unified toolbar, icon rail, frosted explorer, tabbed editor with
 * breadcrumbs, docked assistant, optional activity panel and a status bar.
 */
export function IdeShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const assistantOpen = useIdeStore((s) => s.assistantOpen);
  const assistantWidth = useIdeStore((s) => s.assistantWidth);
  const bottomOpen = useIdeStore((s) => s.bottomOpen);
  const bottomHeight = useIdeStore((s) => s.bottomHeight);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd only on macOS (where Ctrl+T and Ctrl+P edit text). Elsewhere Ctrl or the Win/Super
      // key, unchanged from before.
      const mod = isMacPlatform() ? e.metaKey : e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (!e.shiftKey && key === 'j') run(() => useIdeStore.getState().toggleBottom());
      else if (!e.shiftKey && key === 'p') run(() => useUiStore.getState().setPaletteOpen(true));
      else if (!e.shiftKey && key === 't') {
        run(() => {
          conversationsStore.getState().newChat();
          useUiStore.getState().setView('chat');
        });
      } else if (!e.shiftKey && key === 'l') {
        run(() => {
          const lock = useLockStore.getState();
          if (lock.hasPin) lock.lock();
          else toast('Set a PIN in Settings to use the lock');
        });
      } else if (e.shiftKey && key === 'a') run(() => useIdeStore.getState().toggleAssistant());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-bg" data-testid="ide-shell">
      <TitleBar />
      <div className="flex min-h-0 flex-1 gap-1 px-2 pb-2">
        <ActivityBar />
        {sidebarOpen && <Explorer />}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <EditorArea />
          {bottomOpen && (
            <>
              <ResizeHandle
                orientation="horizontal"
                label="Resize activity panel"
                className="-my-0.5 self-stretch"
                onDrag={(y) =>
                  useIdeStore
                    .getState()
                    .setBottomHeight(window.innerHeight - y - STATUS_BAR - GUTTER)
                }
              />
              <BottomPanel height={bottomHeight} />
            </>
          )}
        </div>
        {assistantOpen && (
          <>
            <ResizeHandle
              orientation="vertical"
              label="Resize assistant"
              className="-mx-0.5"
              onDrag={(x) =>
                useIdeStore.getState().setAssistantWidth(window.innerWidth - x - GUTTER)
              }
            />
            <AssistantPanel width={assistantWidth} />
          </>
        )}
      </div>
      <Hud />
    </div>
  );
}
