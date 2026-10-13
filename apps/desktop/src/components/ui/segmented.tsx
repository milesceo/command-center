import { cn } from '../../lib/cn';

interface Props<T extends string | number> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** A row of mutually exclusive choices (the toggle-group look used across Usage, Prompts and Settings). */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-control border border-border text-xs"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-2.5 py-1.5 first:rounded-l-control last:rounded-r-control',
            value === o.value ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
