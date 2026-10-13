import { cn } from '../../lib/cn';
import type { Prompt } from '../../lib/types';

interface Props {
  items: Prompt[];
  selected: number;
  /** Total saved prompts, to tell "none match" from "library is empty". */
  libraryEmpty: boolean;
  onChoose: (prompt: Prompt) => void;
  onHover: (index: number) => void;
}

/** The picker that opens above the composer when a line starts with `/`. */
export function SlashMenu({ items, selected, libraryEmpty, onChoose, onHover }: Props) {
  return (
    <div
      role="listbox"
      aria-label="Saved prompts"
      className="absolute right-0 bottom-full left-0 z-20 mb-1 max-h-64 overflow-y-auto rounded-panel border border-border-strong bg-elevated p-1 shadow-xl"
    >
      {items.length === 0 && (
        <p className="px-2 py-2 text-xs text-fg-subtle">
          {libraryEmpty
            ? 'Your prompt library is empty. Create prompts in the Prompts view.'
            : 'No saved prompts match.'}
        </p>
      )}
      {items.map((p, i) => (
        <button
          key={p.id}
          type="button"
          role="option"
          aria-selected={i === selected}
          // mousedown, not click: the textarea must keep focus and its caret.
          onMouseDown={(e) => {
            e.preventDefault();
            onChoose(p);
          }}
          onMouseEnter={() => onHover(i)}
          className={cn(
            'flex w-full flex-col items-start rounded-control px-2 py-1.5 text-left',
            i === selected && 'bg-hover',
          )}
        >
          <span className="flex w-full items-center gap-2 text-[13px]">
            <span className="truncate font-medium">{p.title}</span>
            {p.tags.slice(0, 3).map((t) => (
              <span key={t} className="shrink-0 text-[11px] text-fg-subtle">
                #{t}
              </span>
            ))}
          </span>
          <span className="w-full truncate text-xs text-fg-subtle">
            {p.body.replace(/\s+/g, ' ')}
          </span>
        </button>
      ))}
    </div>
  );
}
