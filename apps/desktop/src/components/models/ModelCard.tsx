import { LOCAL_RUNTIME_INFO } from '@command-center/protocol';
import { Cloud, Laptop, MessageSquare, Pencil, SquareTerminal, Trash2 } from 'lucide-react';
import type { CustomModel } from '../../lib/repo-models';
import { Button } from '../ui/button';

interface Props {
  model: CustomModel;
  /** Ticked for the side-by-side test. */
  selected: boolean;
  /** Running (the runtime's server lists this model); null when unknown or a cloud model. */
  serving: boolean | null;
  onToggle: () => void;
  onChat: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Present for local models that can be started from here. */
  onRun?: () => void;
}

/** One Model Lab model: where it runs, what it is, and what can be done with it. */
export function ModelCard({
  model,
  selected,
  serving,
  onToggle,
  onChat,
  onEdit,
  onDelete,
  onRun,
}: Props) {
  const local = model.provider === 'local';
  const where = local
    ? model.runtime
      ? LOCAL_RUNTIME_INFO[model.runtime].label
      : 'This computer'
    : 'Hugging Face cloud';
  const checkboxId = `test-${model.id}`;
  return (
    <li className="flex items-start gap-3 rounded-panel border border-border bg-elevated p-3">
      <input
        id={checkboxId}
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="mt-1 accent-[var(--color-accent)]"
        aria-label={`Include ${model.displayName} in the test`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={checkboxId} className="truncate text-[13px] font-medium">
            {model.displayName}
          </label>
          <span className="flex items-center gap-1 rounded-control border border-border px-1.5 py-0.5 text-[11px] text-fg-muted">
            {local ? <Laptop size={11} aria-hidden /> : <Cloud size={11} aria-hidden />}
            {where}
          </span>
          {serving !== null && (
            <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${serving ? 'bg-success' : 'bg-fg-subtle'}`}
              />
              {serving ? 'Running' : 'Not running'}
            </span>
          )}
          {model.tags.map((t) => (
            <span
              key={t}
              className="rounded-control bg-hover px-1.5 py-0.5 text-[11px] text-fg-muted"
            >
              {t}
            </span>
          ))}
        </div>
        <p className="truncate font-mono text-[11px] text-fg-subtle" title={model.model}>
          {model.filePath ?? model.model}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onRun && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Run ${model.displayName} in Terminal`}
            title="Run in Terminal"
            onClick={onRun}
          >
            <SquareTerminal size={14} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Chat with ${model.displayName}`}
          title="New chat"
          onClick={onChat}
        >
          <MessageSquare size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Settings for ${model.displayName}`}
          title="Settings"
          onClick={onEdit}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${model.displayName}`}
          title="Remove"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </li>
  );
}
