import { cn } from '../../lib/cn';

/** An on/off switch with an accessible name; the caller shows the visible label next to it. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Id of the text that explains the switch. */
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-border-strong bg-hover',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 size-3.5 rounded-full transition-all',
          checked ? 'left-[1.15rem] bg-accent-fg' : 'left-0.5 bg-fg-muted',
        )}
      />
    </button>
  );
}
