import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { PIN_MAX, PIN_MIN } from '../../lib/app-lock';
import { cn } from '../../lib/cn';

/** Drops control characters and anything past the maximum length (by code point). */
export function clampPin(raw: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  return [...raw.replace(/[\u0000-\u001f\u007f]/g, '')].slice(0, PIN_MAX).join('');
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Enter was pressed with at least the minimum number of characters. */
  onSubmit?: () => void;
  /** Accessible name of the entry ("PIN", "Confirm PIN", ...). Ignored when `labelledBy` is set. */
  label?: string;
  /** Id of an element that names the entry (the lock screen's prompt). */
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  /** Grab focus when mounted (and whenever `disabled` turns off). */
  autoFocus?: boolean;
  /** Keep focus here while this screen is active (refocus after a stray blur). */
  keepFocus?: boolean;
  /** Increase to play the wrong-PIN shake. */
  shake?: number;
  reveal: boolean;
  /** When given, the eye button is drawn beside the circles and calls this. */
  onRevealChange?: ((next: boolean) => void) | undefined;
}

/**
 * The PIN field: eight circles that are the input. Typing goes to a visually hidden but
 * focusable input, so keyboard entry, paste, Backspace and screen readers all work; the circles
 * only draw what was typed (a dot, or the character when revealed). Slots 1 to 4 carry a subtle
 * marker for the required minimum.
 */
export function PinCircles({
  value,
  onChange,
  onSubmit,
  label = 'PIN',
  labelledBy,
  describedBy,
  disabled = false,
  autoFocus = false,
  keepFocus = false,
  shake = 0,
  reveal,
  onRevealChange,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const chars = [...value];

  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled]);

  const focus = () => {
    if (!disabled) input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (chars.length >= PIN_MIN && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    } else if (e.key === 'Escape') {
      if (value.length > 0) {
        e.preventDefault();
        onChange('');
      }
    }
  };

  const status =
    chars.length === 0
      ? `Enter ${PIN_MIN} to ${PIN_MAX} characters.`
      : chars.length < PIN_MIN
        ? `${chars.length} of ${PIN_MAX} characters entered. ${PIN_MIN - chars.length} more needed.`
        : `${chars.length} of ${PIN_MAX} characters entered.`;

  return (
    <div className="flex items-center gap-3" data-testid="pin-circles">
      <input
        ref={input}
        // Visually hidden, not display:none, so it stays focusable and readable by assistive tech.
        className="sr-only"
        type={reveal ? 'text' : 'password'}
        value={value}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': label })}
        aria-describedby={describedBy ? `${describedBy} ${hintId}` : hintId}
        onChange={(e) => onChange(clampPin(e.target.value))}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!keepFocus) return;
          // After a stray click elsewhere focus lands on <body>; take it back. Focus that moved
          // to another control (a button, a dialog) is left alone.
          requestAnimationFrame(() => {
            const active = document.activeElement;
            if (!active || active === document.body) focus();
          });
        }}
      />
      <span id={hintId} className="sr-only" aria-live="polite">
        {status}
      </span>

      <div
        key={shake}
        aria-hidden="true"
        onPointerDown={(e) => {
          e.preventDefault(); // keep the caret in the hidden input
          focus();
        }}
        className={cn(
          'flex cursor-text items-center gap-2 rounded-panel px-1 py-1',
          shake > 0 && 'pin-shake',
          disabled && 'opacity-60',
        )}
      >
        {Array.from({ length: PIN_MAX }, (_, i) => {
          const filled = i < chars.length;
          const required = i < PIN_MIN;
          const active = i === Math.min(chars.length, PIN_MAX - 1) && !disabled;
          return (
            <span
              key={i}
              data-slot={i + 1}
              data-filled={filled}
              data-required={required}
              className={cn(
                'relative grid size-8 place-items-center rounded-full border font-mono text-[15px] leading-none transition-colors',
                filled
                  ? 'border-accent bg-accent/15 text-fg'
                  : required
                    ? 'border-border-strong bg-transparent'
                    : 'border-border bg-transparent opacity-50',
                active && !filled && 'border-accent',
              )}
            >
              {filled &&
                (reveal ? (
                  <span>{chars[i]}</span>
                ) : (
                  <span className="size-2.5 rounded-full bg-accent" />
                ))}
              {required && !filled && (
                <span
                  data-testid="required-mark"
                  className="absolute -bottom-1.5 h-0.5 w-3 rounded-full bg-border-strong"
                />
              )}
            </span>
          );
        })}
      </div>

      {onRevealChange && (
        <button
          type="button"
          aria-label={reveal ? 'Hide PIN' : 'Show PIN'}
          aria-pressed={reveal}
          disabled={disabled}
          // A mouse press must not take focus from the row being typed in; a keyboard
          // activation (detail 0) moves focus back to the entry afterwards.
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            onRevealChange(!reveal);
            if (e.detail === 0) focus();
          }}
          className="grid size-9 shrink-0 place-items-center rounded-control border border-border text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      )}
    </div>
  );
}
