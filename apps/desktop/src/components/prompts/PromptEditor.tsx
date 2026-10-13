import { useState } from 'react';
import { cn } from '../../lib/cn';
import { parseTagInput } from '../../lib/prompt-library';
import { extractVariables } from '../../lib/prompt-vars';
import type { PromptInput } from '../../lib/repo-prompts';
import type { Prompt, PromptKind } from '../../lib/types';
import { Button } from '../ui/button';
import { Modal } from '../ui/dialog';

const KINDS: { id: PromptKind; label: string; hint: string }[] = [
  { id: 'prompt', label: 'Prompt', hint: 'Inserted into the message box (type / to find it).' },
  {
    id: 'system',
    label: 'System prompt',
    hint: 'Instructions attached to a conversation or project.',
  },
];

interface Props {
  initial?: Prompt;
  /** Pre-select the kind for a new prompt. */
  defaultKind?: PromptKind;
  onSave: (input: PromptInput) => void;
  onCancel: () => void;
}

/** Create or edit a saved prompt. Variables are the `{{names}}` found in the body. */
export function PromptEditor({ initial, defaultKind = 'prompt', onSave, onCancel }: Props) {
  const [kind, setKind] = useState<PromptKind>(initial?.kind ?? defaultKind);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const variables = extractVariables(body);
  const valid = title.trim() !== '' && body.trim() !== '';

  return (
    <Modal title={initial ? 'Edit prompt' : 'New prompt'} onClose={onCancel} width="max-w-xl">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ kind, title, body, tags: parseTagInput(tags) });
        }}
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 text-xs">
          <fieldset className="flex gap-2">
            <legend className="sr-only">Kind</legend>
            {KINDS.map((k) => (
              <label
                key={k.id}
                className={cn(
                  'flex-1 cursor-pointer rounded-control border p-2',
                  kind === k.id ? 'border-accent bg-hover' : 'border-border hover:bg-hover',
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  className="sr-only"
                  checked={kind === k.id}
                  onChange={() => setKind(k.id)}
                />
                <span className="block font-medium">{k.label}</span>
                <span className="block text-[11px] text-fg-subtle">{k.hint}</span>
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-fg-muted">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-control border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-fg-muted">Tags</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="review, rust"
              className="rounded-control border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-fg-muted">Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Review the following {{language}} code for bugs:&#10;&#10;{{code}}"
              className="selectable resize-y rounded-control border border-border bg-surface p-2 font-mono text-[13px] outline-none focus:border-border-strong"
            />
            <span className="text-[11px] text-fg-subtle">
              Write <code className="font-mono">{'{{name}}'}</code> where a value should be filled
              in each time.
            </span>
          </label>

          <div aria-label="Variables" className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-fg-subtle">Variables:</span>
            {variables.length === 0 && <span className="text-[11px] text-fg-subtle">none</span>}
            {variables.map((v) => (
              <span
                key={v}
                className="rounded-control border border-border px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
              >
                {v}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
