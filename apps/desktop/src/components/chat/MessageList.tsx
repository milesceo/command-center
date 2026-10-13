import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chatStore, useChat } from '../../stores/chat';
import { useConversations } from '../../stores/conversations';
import { Button } from '../ui/button';
import { ErrorNotice } from './ErrorNotice';
import { MessageItem } from './MessageItem';
import { StreamingMessage } from './StreamingMessage';

/** Within this many pixels of the bottom counts as "following" the conversation. */
const STICK_THRESHOLD = 80;

/**
 * Virtualized transcript. Only rows near the viewport are mounted, so long
 * conversations stay cheap; rows are measured because markdown heights vary
 * and grow while streaming. Auto-scroll follows new content only while the
 * user is already at the bottom; scrolling up pauses it until they come back
 * or press "Jump to latest".
 */
export function MessageList() {
  const activeId = useConversations((s) => s.activeId);
  const messages = useChat((s) => s.messages);
  const stream = useChat((s) => (activeId ? s.streams[activeId] : undefined));
  const error = useChat((s) => (activeId ? s.errors[activeId] : undefined));
  const streaming = stream !== undefined;

  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Row model: stored messages, then the live reply, then a failure banner.
  const rowCount = messages.length + (stream ? 1 : 0) + (error ? 1 : 0);
  // eslint-disable-next-line react-hooks/incompatible-library -- no React Compiler in this app
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => {
      const message = messages[index];
      if (message) return message.id;
      return index === messages.length && stream ? 'stream' : 'error';
    },
  });

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stick.current = near;
    setAtBottom(near);
  };

  // New conversation: start at the bottom.
  useEffect(() => {
    stick.current = true;
    setAtBottom(true);
  }, [activeId]);

  // Follow growth (new rows, streaming text, re-measured heights) while pinned to the bottom.
  const totalSize = virtualizer.getTotalSize();
  const lastMessageId = messages[messages.length - 1]?.id;
  useLayoutEffect(() => {
    if (stick.current) scrollToEnd();
  }, [totalSize, rowCount, lastMessageId, scrollToEnd]);

  // Sending always jumps to the bottom, even if the user had scrolled up.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'user') {
      stick.current = true;
      scrollToEnd();
    }
  }, [lastMessageId, messages, scrollToEnd]);

  const regenerate = useCallback(() => void chatStore.getState().regenerate(), []);
  const edit = useCallback(
    (id: string, text: string) => void chatStore.getState().editAndResend(id, text),
    [],
  );

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const lastId = messages[messages.length - 1]?.id;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto"
        data-testid="message-scroll"
      >
        <div className="relative mx-auto w-full max-w-3xl px-6" style={{ height: totalSize }}>
          {virtualizer.getVirtualItems().map((row) => {
            const message = messages[row.index];
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full py-3"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {message ? (
                  <MessageItem
                    message={message}
                    canRegenerate={
                      !streaming && message.id === lastAssistantId && message.id === lastId
                    }
                    canEdit={!streaming}
                    onEdit={edit}
                    onRegenerate={regenerate}
                  />
                ) : stream && row.index === messages.length ? (
                  <StreamingMessage stream={stream} />
                ) : error && activeId ? (
                  <ErrorNotice
                    error={error}
                    onRetry={regenerate}
                    onDismiss={() => chatStore.getState().dismissError(activeId)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {!atBottom && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg"
          onClick={() => {
            stick.current = true;
            scrollToEnd();
            setAtBottom(true);
          }}
        >
          <ArrowDown size={12} />
          Jump to latest
        </Button>
      )}
    </div>
  );
}
