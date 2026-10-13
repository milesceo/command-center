import { PanelLeft, PanelRight, SendHorizontal } from 'lucide-react';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';

export function MainPanel() {
  const { toggleSidebar, toggleRightPanel, rightPanelOpen } = useUiStore();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <Button variant="ghost" size="icon" aria-label="Toggle sidebar" onClick={toggleSidebar}>
          <PanelLeft size={15} />
        </Button>
        <span className="text-xs text-fg-muted">New chat</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Toggle preview panel"
          aria-pressed={rightPanelOpen}
          onClick={toggleRightPanel}
        >
          <PanelRight size={15} />
        </Button>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-2xl">
          <h1 className="text-xl font-semibold tracking-tight">What are we building?</h1>
          <p className="mt-1 text-fg-muted">
            Ask about code, paste an error, or describe a change. Chat arrives in the next phase.
          </p>
        </div>
      </section>

      <footer className="px-6 pb-5">
        <div className="mx-auto flex w-full max-w-2xl items-end gap-2 rounded-panel border border-border bg-elevated p-2 focus-within:border-border-strong">
          <textarea
            rows={1}
            disabled
            placeholder="Message Programish…"
            aria-label="Message"
            className="selectable max-h-40 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 font-mono text-[13px] outline-none placeholder:text-fg-subtle"
          />
          <Button variant="primary" size="icon" disabled aria-label="Send">
            <SendHorizontal size={14} />
          </Button>
        </div>
      </footer>
    </main>
  );
}
