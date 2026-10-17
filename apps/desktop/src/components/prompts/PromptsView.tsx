import { Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { LibraryFileError } from '../../lib/prompt-library';
import { extractVariables } from '../../lib/prompt-vars';
import { searchPrompts, type PromptInput } from '../../lib/repo-prompts';
import { saveTextFile } from '../../lib/save-file';
import type { Prompt, PromptKind } from '../../lib/types';
import { useComposerStore } from '../../stores/composer';
import { promptsStore, usePrompts } from '../../stores/prompts';
import { toast } from '../../stores/toast';
import { useUiStore } from '../../stores/ui';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/dialog';
import { PromptEditor } from './PromptEditor';
import { usePromptActions } from './usePromptActions';

type Filter = 'all' | PromptKind;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'prompt', label: 'Prompts' },
  { id: 'system', label: 'System prompts' },
];

/** The prompt library: browse, search, create, edit, delete, insert, and import/export as JSON. */
export function PromptsView() {
  const { prompts, loaded, error } = usePrompts((s) => s);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [editing, setEditing] = useState<Prompt | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Prompt | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const actions = usePromptActions();

  const allTags = useMemo(
    () => [...new Set(prompts.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b)),
    [prompts],
  );
  const shown = useMemo(
    () =>
      searchPrompts(prompts, query, filter === 'all' ? undefined : filter).filter(
        (p) => tag === null || p.tags.includes(tag),
      ),
    [prompts, query, filter, tag],
  );

  const save = async (input: PromptInput) => {
    const store = promptsStore.getState();
    if (editing === 'new') await store.create(input);
    else if (editing) await store.update(editing.id, input);
    setEditing(null);
  };

  const exportLibrary = async () => {
    try {
      if (await saveTextFile('command-center-prompts.json', promptsStore.getState().exportJson()))
        toast('Library exported');
    } catch (err) {
      toast(`Could not export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const importLibrary = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await promptsStore.getState().importJson(await file.text());
      toast(
        `Imported: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`,
      );
    } catch (err) {
      toast(
        err instanceof LibraryFileError
          ? err.message
          : `Could not import: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const insert = (p: Prompt) =>
    actions.requestText(p, (text) => {
      useComposerStore.getState().insert(text);
      useUiStore.getState().setView('chat');
    });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="prompts-view">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Prompt library</h1>
            <p className="text-[11px] text-fg-subtle">
              Saved prompts and system prompts. Type <kbd className="font-mono">/</kbd> in the
              message box to insert one.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              hidden
              data-testid="import-input"
              onChange={(e) => {
                void importLibrary(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button size="sm" onClick={() => importInput.current?.click()}>
              <Upload size={12} />
              Import
            </Button>
            <Button size="sm" onClick={() => void exportLibrary()} disabled={prompts.length === 0}>
              <Download size={12} />
              Export
            </Button>
            <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
              <Plus size={12} />
              New prompt
            </Button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-subtle"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, tags or text"
              aria-label="Search prompts"
              className="h-8 w-full rounded-control border border-border bg-bg pr-2 pl-7 text-[13px] outline-none placeholder:text-fg-subtle focus:border-border-strong"
            />
          </div>
          <div
            role="group"
            aria-label="Kind"
            className="flex rounded-control border border-border text-xs"
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'px-2.5 py-1.5 first:rounded-l-control last:rounded-r-control',
                  filter === f.id ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
            {allTags.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tag === t}
                onClick={() => setTag(tag === t ? null : t)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px]',
                  tag === t
                    ? 'border-accent bg-hover text-fg'
                    : 'border-border text-fg-muted hover:text-fg',
                )}
              >
                #{t}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {!loaded && !error && (
          <div className="flex flex-col gap-2" role="status" aria-label="Loading prompts">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {loaded && prompts.length === 0 && (
          <p className="rounded-panel border border-dashed border-border p-8 text-center text-xs text-fg-subtle">
            No saved prompts yet. Create one, or import a library file.
          </p>
        )}
        {loaded && prompts.length > 0 && shown.length === 0 && (
          <p className="text-xs text-fg-subtle">Nothing matches.</p>
        )}

        <ul className="flex flex-col gap-2">
          {shown.map((p) => {
            const variables = extractVariables(p.body);
            return (
              <li
                key={p.id}
                className="rounded-panel border border-border bg-surface p-3"
                data-testid="prompt-item"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                      {p.title}
                      <span className="rounded-control border border-border px-1.5 py-0.5 text-[10px] font-normal text-fg-subtle">
                        {p.kind === 'system' ? 'system prompt' : 'prompt'}
                      </span>
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs whitespace-pre-wrap text-fg-muted">
                      {p.body}
                    </p>
                    <p className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
                      {p.tags.map((t) => (
                        <span key={t}>#{t}</span>
                      ))}
                      {variables.map((v) => (
                        <span key={v} className="font-mono text-fg-muted">{`{{${v}}}`}</span>
                      ))}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {p.kind === 'prompt' ? (
                      <Button size="sm" onClick={() => insert(p)}>
                        Insert
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => actions.attachSystemPrompt(p)}>
                        Use in this chat
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Edit ${p.title}`}
                      onClick={() => setEditing(p)}
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Delete ${p.title}`}
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {editing && (
        <PromptEditor
          {...(editing === 'new' ? {} : { initial: editing })}
          {...(filter === 'system' ? { defaultKind: 'system' as const } : {})}
          onSave={(input) => void save(input)}
          onCancel={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this prompt?"
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void promptsStore.getState().remove(deleting.id);
          setDeleting(null);
        }}
      >
        <p>
          “{deleting?.title}” will be removed from the library. Chats and projects that used it keep
          working without it.
        </p>
      </ConfirmDialog>
      {actions.dialog}
    </div>
  );
}
