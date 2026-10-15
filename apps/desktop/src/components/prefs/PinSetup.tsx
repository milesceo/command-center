import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { isValidPin, PIN_MAX, PIN_MIN, pinStrength } from '../../lib/app-lock';
import { cn } from '../../lib/cn';

const STRENGTH_COLORS = ['bg-danger', 'bg-warning', 'bg-accent', 'bg-success'] as const;

/**
 * Enter-and-confirm PIN entry with a show/hide toggle and a strength hint. Calls `onChange`
 * with the PIN once both fields match and it is valid, and with null otherwise, so the parent
 * only has to enable its button on a non-null value.
 */
export function PinSetup({
  onChange,
  autoFocus = false,
}: {
  onChange: (pin: string | null) => void;
  autoFocus?: boolean;
}) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState(false);
  const id = useId();

  const emit = (nextPin: string, nextAgain: string) => {
    onChange(isValidPin(nextPin) && nextPin === nextAgain ? nextPin : null);
  };

  const strength = pinStrength(pin);
  const mismatch = again.length > 0 && pin !== again;
  const tooShort = pin.length > 0 && !isValidPin(pin);
  const type = shown ? 'text' : 'password';
  const field =
    'h-9 w-full rounded-control border border-border bg-bg px-3 font-mono text-[14px] tracking-widest text-fg outline-none focus:border-accent';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-pin`} className="text-[12px] text-fg-muted">
          PIN ({PIN_MIN} to {PIN_MAX} characters: letters, numbers, symbols)
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-pin`}
            type={type}
            autoComplete="new-password"
            autoFocus={autoFocus}
            value={pin}
            maxLength={PIN_MAX * 2}
            onChange={(e) => {
              setPin(e.target.value);
              emit(e.target.value, again);
            }}
            className={field}
            aria-describedby={`${id}-hint`}
          />
          <button
            type="button"
            aria-label={shown ? 'Hide PIN' : 'Show PIN'}
            aria-pressed={shown}
            onClick={() => setShown((v) => !v)}
            className="grid size-9 shrink-0 place-items-center rounded-control border border-border text-fg-muted hover:bg-hover hover:text-fg"
          >
            {shown ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <div className="mt-1 flex items-center gap-2" id={`${id}-hint`}>
          <span aria-hidden="true" className="flex h-1.5 w-28 gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  'h-full flex-1 rounded-full',
                  pin.length > 0 && i <= strength.score
                    ? STRENGTH_COLORS[strength.score]
                    : 'bg-border-strong',
                )}
              />
            ))}
          </span>
          <span className="text-[11px] text-fg-subtle" aria-live="polite">
            {tooShort
              ? `Use ${PIN_MIN} to ${PIN_MAX} characters.`
              : pin.length > 0
                ? `${strength.label}. A longer PIN with mixed characters is harder to guess.`
                : 'Longer and mixed is stronger; short PINs rely on the attempt delays.'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-again`} className="text-[12px] text-fg-muted">
          Confirm PIN
        </label>
        <input
          id={`${id}-again`}
          type={type}
          autoComplete="new-password"
          value={again}
          maxLength={PIN_MAX * 2}
          onChange={(e) => {
            setAgain(e.target.value);
            emit(pin, e.target.value);
          }}
          className={field}
        />
        {mismatch && (
          <p role="alert" className="text-[11px] text-danger">
            The PINs do not match.
          </p>
        )}
      </div>
    </div>
  );
}
