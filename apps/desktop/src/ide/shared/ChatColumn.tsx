import { Composer } from '../../components/chat/Composer';
import { MessageList } from '../../components/chat/MessageList';
import { useChat } from '../../stores/chat';
import { useConversations } from '../../stores/conversations';

/** The real transcript and composer, for concepts that keep a conventional chat column. */
export function ChatColumn({
  emptyHint,
  padded = false,
}: {
  emptyHint?: string;
  padded?: boolean;
}) {
  const activeId = useConversations((s) => s.activeId);
  const hasContent = useChat((s) => s.messages.length > 0 || Object.keys(s.streams).length > 0);
  const show = hasContent && activeId !== null;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {show ? (
        <div
          className={padded ? 'flex min-h-0 flex-1 flex-col px-3' : 'flex min-h-0 flex-1 flex-col'}
        >
          <MessageList />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <p className="text-fg-muted">{emptyHint ?? 'Start a thread below.'}</p>
        </div>
      )}
      <Composer />
    </div>
  );
}
