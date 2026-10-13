import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { MODEL_OPTIONS, type Attachment } from '@programish/protocol';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { AttachmentError, MAX_ATTACHMENTS, readTextFile } from '../../lib/attachments';
import { cn } from '../../lib/cn';
import { chatStore, useChat } from '../../stores/chat';
import {
  conversationsStore,
  useActiveSettings,
  useConversations,
} from '../../stores/conversations';
import { Button } from '../ui/button';
import { ChatSettings } from './ChatSettings';

const MAX_HEIGHT_PX = 220;

/** Multiline input: Enter sends, Shift+Enter inserts a newline; text files can be pasted, dropped or picked. */
export function Composer() {
  const activeId = useConversations((s) => s.activeId);
  const settings = useActiveSettings();
  const streaming = useChat((s) => (activeId ? s.streams[activeId] !== undefined : false));

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Grow with the content up to a cap, then scroll.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  // Switching conversations or starting a new chat: focus the input.
  useEffect(() => {
    area.current?.focus();
  }, [activeId]);

  const addFiles = useCallback(async (files: File[]) => {
    const added: Attachment[] = [];
    let problem: string | null = null;
    for (const file of files) {
      try {
        added.push(await readTextFile(file));
      } catch (err) {
        problem = err instanceof AttachmentError ? err.message : `Could not read ${file.name}.`;
      }
    }
    setAttachments((current) => {
      const next = [...current, ...added];
      if (next.length > MAX_ATTACHMENTS) problem = `You can attach up to ${MAX_ATTACHMENTS} files.`;
      return next.slice(0, MAX_ATTACHMENTS);
    });
    setNotice(problem);
  }, []);

  const submit = () => {
    if (streaming) return;
    if (!text.trim() && attachments.length === 0) return;
    const message = text;
    const files = attachments;
    setText('');
    setAttachments([]);
    setNotice(null);
    void chatStore.getState().send(message, files);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing: Enter confirms an IME candidate and must not send.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles([...e.dataTransfer.files]);
  };

  return (
    <footer className="px-6 pb-5">
      <div
        className={cn(
          'relative mx-auto w-full max-w-3xl rounded-panel border bg-elevated p-2 transition-colors focus-within:border-border-strong',
          dragging ? 'border-accent' : 'border-border',
        )}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-panel bg-elevated/90 text-fg-muted">
            Drop text files to attach
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1.5 px-1 pt-1">
            {attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="inline-flex items-center gap-1 rounded-control border border-border bg-surface py-0.5 pr-0.5 pl-1.5 text-xs text-fg-muted"
              >
                <Paperclip size={11} />
                {a.name}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  className="rounded p-0.5 hover:bg-hover hover:text-fg"
                  onClick={() => setAttachments((cur) => cur.filter((_, j) => j !== i))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={area}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Message Programish…"
          aria-label="Message"
          className="selectable block max-h-56 min-h-9 w-full resize-none bg-transparent px-2 py-1.5 font-mono text-[13px] outline-none placeholder:text-fg-subtle"
        />

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1">
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              data-testid="file-input"
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Attach files"
              title="Attach text files"
              onClick={() => picker.current?.click()}
            >
              <Paperclip size={14} />
            </Button>
            <select
              aria-label="Model"
              value={settings.model ?? 'default'}
              onChange={(e) =>
                void conversationsStore
                  .getState()
                  .updateSettings({ model: e.target.value === 'default' ? null : e.target.value })
              }
              className="h-7 rounded-control bg-transparent px-1.5 text-xs text-fg-muted outline-none hover:bg-hover"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id} className="bg-elevated">
                  {m.label}
                </option>
              ))}
            </select>
            <ChatSettings key={activeId ?? 'draft'} />
          </div>

          {streaming ? (
            <Button
              variant="primary"
              size="icon"
              aria-label="Stop generating"
              title="Stop"
              onClick={() => activeId && chatStore.getState().stop(activeId)}
            >
              <Square size={12} fill="currentColor" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="icon"
              aria-label="Send"
              title="Send (Enter)"
              disabled={!text.trim() && attachments.length === 0}
              onClick={submit}
            >
              <ArrowUp size={14} />
            </Button>
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className="mx-auto mt-1.5 w-full max-w-3xl px-1 text-xs text-warning">
          {notice}
        </p>
      )}
    </footer>
  );
}
