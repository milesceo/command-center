import { PanelLeft, PanelRight } from 'lucide-react';
import { useChat } from '../../stores/chat';
import { useConversations } from '../../stores/conversations';
import { useUiStore } from '../../stores/ui';
import { Composer } from '../chat/Composer';
import { MessageList } from '../chat/MessageList';
import { Button } from '../ui/button';

export function MainPanel() {
  const { toggleSidebar, toggleRightPanel, rightPanelOpen } = useUiStore();
  const title = useConversations(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.title ?? 'New chat',
  );
  const hasContent = useChat((s) => s.messages.length > 0 || Object.keys(s.streams).length > 0);
  const activeId = useConversations((s) => s.activeId);
  const showTranscript = hasContent && activeId !== null;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <Button variant="ghost" size="icon" aria-label="Toggle sidebar" onClick={toggleSidebar}>
          <PanelLeft size={15} />
        </Button>
        <h1 className="max-w-[60%] truncate text-xs text-fg-muted">{title}</h1>
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

      {showTranscript ? (
        <MessageList />
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="w-full max-w-3xl">
            <h2 className="text-xl font-semibold tracking-tight">What are we building?</h2>
            <p className="mt-1 text-fg-muted">Ask about code, paste an error, or drop in a file.</p>
          </div>
        </section>
      )}

      <Composer />
    </main>
  );
}
