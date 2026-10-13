import { Paperclip, Pencil, RefreshCw } from 'lucide-react';
import { memo, useState } from 'react';
import type { Message } from '../../lib/types';
import { Button } from '../ui/button';
import { CopyButton } from '../ui/copy-button';
import { ErrorNotice } from './ErrorNotice';
import { Markdown } from './Markdown';

interface Props {
  message: Message;
  /** Only the final assistant reply can be regenerated. */
  canRegenerate: boolean;
  /** Editing rewinds history, so it is disabled while a reply is streaming. */
  canEdit: boolean;
  onEdit: (messageId: string, text: string) => void;
  onRegenerate: () => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  canRegenerate,
  canEdit,
  onEdit,
  onRegenerate,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (message.role === 'user') {
    return (
      <div className="group flex items-start justify-end gap-1" data-role="user">
        {editing ? (
          <div className="w-full rounded-panel border border-border-strong bg-elevated p-2">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Edit message"
              rows={Math.min(10, Math.max(2, draft.split('\n').length))}
              className="selectable w-full resize-none bg-transparent p-1 font-mono text-[13px] outline-none"
            />
            <div className="mt-1 flex justify-end gap-2">
              <Button size="sm" onClick={() => (setEditing(false), setDraft(message.content))}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!draft.trim() && message.attachments.length === 0}
                onClick={() => (setEditing(false), onEdit(message.id, draft))}
              >
                Save &amp; resend
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-1 flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <CopyButton className="size-6" text={message.content} label="Copy message" />
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label="Edit message"
                  title="Edit and resend"
                  onClick={() => (setDraft(message.content), setEditing(true))}
                >
                  <Pencil size={14} />
                </Button>
              )}
            </div>
            <div className="max-w-[85%] rounded-panel border border-border bg-elevated px-3 py-2">
              {message.attachments.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {message.attachments.map((a, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-control border border-border px-1.5 py-0.5 text-xs text-fg-muted"
                    >
                      <Paperclip size={11} />
                      {a.name}
                    </span>
                  ))}
                </div>
              )}
              <p className="selectable whitespace-pre-wrap break-words">{message.content}</p>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-1" data-role="assistant">
      <Markdown text={message.content} messageId={message.id} />
      {message.status === 'stopped' && <p className="text-xs text-fg-subtle">Stopped</p>}
      {message.status === 'error' && message.error && <ErrorNotice error={message.error} />}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton className="size-6" text={message.content} label="Copy reply" />
        {canRegenerate && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Regenerate reply"
            title="Regenerate"
            onClick={onRegenerate}
          >
            <RefreshCw size={14} />
          </Button>
        )}
        {message.model && (
          <span className="ml-1 font-mono text-[11px] text-fg-subtle">
            {message.model}
            {message.outputTokens !== null && ` · ${message.outputTokens} tokens out`}
          </span>
        )}
      </div>
    </div>
  );
});
