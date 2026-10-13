import { Check, Pencil, Pin, PinOff, Search, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import type { Conversation } from '../../lib/types';
import { chatStore, useChat } from '../../stores/chat';
import { conversationsStore, useConversations } from '../../stores/conversations';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/dialog';

function Row({
  conversation,
  active,
  streaming,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  streaming: boolean;
  onDelete: (c: Conversation) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const input = useRef<HTMLInputElement>(null);
  const { select, rename, togglePin } = conversationsStore.getState();

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  const commit = () => {
    setRenaming(false);
    if (title.trim() && title.trim() !== conversation.title) void rename(conversation.id, title);
    else setTitle(conversation.title);
  };

  if (renaming) {
    return (
      <li className="flex items-center gap-1 rounded-control bg-hover px-1.5 py-1">
        <input
          ref={input}
          value={title}
          aria-label="Conversation title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setTitle(conversation.title);
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        <Check size={13} className="text-fg-subtle" />
      </li>
    );
  }

  return (
    <li
      className={cn(
        'group flex items-center rounded-control pr-1 transition-colors',
        active ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      <button
        type="button"
        onClick={() => select(conversation.id)}
        onDoubleClick={() => setRenaming(true)}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
      >
        {conversation.pinned && <Pin size={11} className="shrink-0 text-fg-subtle" />}
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {streaming && <span className="caret shrink-0" aria-label="Generating" />}
      </button>
      <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={conversation.pinned ? 'Unpin' : 'Pin'}
          title={conversation.pinned ? 'Unpin' : 'Pin'}
          onClick={() => void togglePin(conversation.id)}
        >
          {conversation.pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Rename"
          title="Rename"
          onClick={() => setRenaming(true)}
        >
          <Pencil size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Delete"
          title="Delete"
          onClick={() => onDelete(conversation)}
        >
          <Trash2 size={12} />
        </Button>
      </span>
    </li>
  );
}

export function ConversationList() {
  const { conversations, activeId, search, loaded, error } = useConversations((s) => s);
  const streams = useChat((s) => s.streams);
  const [query, setQuery] = useState(search);
  const [pending, setPending] = useState<Conversation | null>(null);

  // Debounce so each keystroke doesn't hit SQLite.
  useEffect(() => {
    const t = setTimeout(() => void conversationsStore.getState().setSearch(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const pinned = conversations.filter((c) => c.pinned);
  const recent = conversations.filter((c) => !c.pinned);
  const searching = search.trim() !== '';

  const section = (label: string, items: Conversation[]) =>
    items.length > 0 && (
      <section>
        <h2 className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
          {label}
        </h2>
        <ul className="flex flex-col gap-px">
          {items.map((c) => (
            <Row
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              streaming={streams[c.id] !== undefined}
              onDelete={setPending}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <>
      <div className="px-3 pb-1">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="h-8 w-full rounded-control border border-border bg-bg pr-6 pl-7 text-[13px] outline-none placeholder:text-fg-subtle focus:border-border-strong"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 text-fg-subtle hover:text-fg"
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {error && <p className="px-2 py-1 text-xs text-danger">Could not load chats: {error}</p>}
        {!error && loaded && conversations.length === 0 && (
          <p className="px-2 py-2 text-xs text-fg-subtle">
            {searching ? 'No chats match your search.' : 'No conversations yet.'}
          </p>
        )}
        {section('Pinned', pinned)}
        {section(searching ? 'Results' : 'Recent', recent)}
      </nav>

      <ConfirmDialog
        open={pending !== null}
        title="Delete this chat?"
        confirmLabel="Delete"
        destructive
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) {
            chatStore.getState().stop(pending.id);
            void conversationsStore.getState().remove(pending.id);
          }
          setPending(null);
        }}
      >
        <p>“{pending?.title}” and all of its messages will be permanently deleted.</p>
      </ConfirmDialog>
    </>
  );
}
