import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import type { Attachment } from '@command-center/protocol';
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
import { searchPrompts } from '../../lib/repo-prompts';
import { applyInsertion, findSlashQuery } from '../../lib/slash';
import { cn } from '../../lib/cn';
import { chatStore, useChat } from '../../stores/chat';
import { useComposerStore } from '../../stores/composer';
import { usePrompts } from '../../stores/prompts';
import { useConversations } from '../../stores/conversations';
import { Button } from '../ui/button';
import { usePromptActions } from '../prompts/usePromptActions';
import { ChatSettings } from './ChatSettings';
import { SlashMenu } from './SlashMenu';

const MAX_HEIGHT_PX = 220;

/** Multiline input: Enter sends, Shift+Enter inserts a newline; text files can be pasted, dropped or picked. */
export function Composer() {
  const activeId = useConversations((s) => s.activeId);
  const streaming = useChat((s) => (activeId ? s.streams[activeId] !== undefined : false));

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0);
  const [selectedItem, setSelectedItem] = useState(0);
  /** The slash token the user dismissed with Escape; the menu stays closed for it. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const prompts = usePrompts((s) => s.prompts);
  const actions = usePromptActions();
  const pendingInsert = useComposerStore((s) => s.pending);
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

  const slash = findSlashQuery(text, caret);
  const slashKey = slash ? `${slash.start}:${slash.query}` : null;
  const matches = slash ? searchPrompts(prompts, slash.query, 'prompt').slice(0, 8) : [];
  const menuOpen = slash !== null && dismissed !== slashKey;

  // Put the caret back where it belongs after a programmatic edit.
  const placeCaret = (position: number) => {
    setCaret(position);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position, position);
    });
  };

  /** Replaces the `/query` token with a prompt (asking for its variables first). */
  const chooseSlash = (prompt: (typeof prompts)[number]) => {
    if (!slash) return;
    const { start } = slash;
    const end = area.current?.selectionStart ?? caret;
    actions.requestText(prompt, (insertion) => {
      const next = applyInsertion(text, start, end, insertion);
      setText(next.text);
      placeCaret(next.caret);
    });
  };

  // Text sent over from the library ("Insert") lands at the caret, or at the end if the box is empty.
  useEffect(() => {
    if (!pendingInsert) return;
    const at = area.current?.selectionStart ?? text.length;
    const next = applyInsertion(text, at, area.current?.selectionEnd ?? at, pendingInsert.text);
    setText(next.text);
    placeCaret(next.caret);
    useComposerStore.getState().consume(pendingInsert.id);
    // `text` is read once for the insertion point; re-running on every keystroke would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInsert]);

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
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = Math.max(1, matches.length);
        setSelectedItem((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && matches[selectedItem]) {
        e.preventDefault();
        chooseSlash(matches[selectedItem]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(slashKey);
        return;
      }
    }
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
      {actions.dialog}
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

        {menuOpen && (
          <SlashMenu
            items={matches}
            selected={Math.min(selectedItem, Math.max(0, matches.length - 1))}
            libraryEmpty={prompts.length === 0}
            onChoose={chooseSlash}
            onHover={setSelectedItem}
          />
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setSelectedItem(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Message Command Center…"
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
