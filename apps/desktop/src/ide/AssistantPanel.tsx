import { Plus, Sparkles } from 'lucide-react';
import { ConversationUsage } from '../components/usage/ConversationUsage';
import { conversationsStore, useConversations } from '../stores/conversations';
import { useUiStore } from '../stores/ui';
import { ChatColumn } from './shared/ChatColumn';

/** The conversation, docked on the right like an editor's assistant panel. */
export function AssistantPanel({ width }: { width: number }) {
  const activeId = useConversations((s) => s.activeId);
  const title = useConversations(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.title ?? 'New thread',
  );

  return (
    <aside
      aria-label="Assistant"
      className="flex shrink-0 flex-col overflow-hidden rounded-panel border border-border bg-surface"
      style={{ width }}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Sparkles size={13} className="shrink-0 text-accent" />
        <h2 className="min-w-0 truncate text-xs font-medium">{title}</h2>
        <span className="ml-auto flex items-center gap-1">
          {activeId && <ConversationUsage conversationId={activeId} />}
          <button
            type="button"
            aria-label="New thread"
            title="New thread (Ctrl+T)"
            onClick={() => {
              conversationsStore.getState().newChat();
              useUiStore.getState().setView('chat');
            }}
            className="grid size-6 place-items-center rounded-control text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Plus size={13} />
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ChatColumn
          padded
          emptyHint="What are we building? Code you ask for opens in the editor."
        />
      </div>
    </aside>
  );
}
