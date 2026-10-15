import { useId, useRef, useState } from 'react';
import { isValidPin, PIN_MAX, PIN_MIN, pinStrength } from '../../lib/app-lock';
import { cn } from '../../lib/cn';
import { PinCircles } from '../pin/PinCircles';

const STRENGTH_COLORS = ['bg-danger', 'bg-warning', 'bg-accent', 'bg-success'] as const;

/**
 * Enter-and-confirm PIN entry on the circle input, with one show/hide toggle for both rows and
 * a strength hint. Calls `onChange` with the PIN once both rows match and it is valid, and with
 * null otherwise, so the parent only has to enable its button on a non-null value. Enter in the
 * first row moves to the confirmation; Enter in the second calls `onSubmit`.
 */
export function PinSetup({
  onChange,
  onSubmit,
  autoFocus = false,
}: {
  onChange: (pin: string | null) => void;
  /** Enter was pressed in the confirmation row with a valid, matching PIN. */
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  // Reset to hidden whenever this component unmounts (leaving the step).
  const [reveal, setReveal] = useState(false);
  const confirmRow = useRef<HTMLDivElement>(null);
  const id = useId();

  const emit = (nextPin: string, nextAgain: string) => {
    onChange(isValidPin(nextPin) && nextPin === nextAgain ? nextPin : null);
  };

  const strength = pinStrength(pin);
  const mismatch = again.length > 0 && pin !== again;
  const tooShort = pin.length > 0 && !isValidPin(pin);
  const matching = isValidPin(pin) && pin === again;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p id={`${id}-pin-label`} className="text-[12px] text-fg-muted">
          PIN ({PIN_MIN} to {PIN_MAX} characters: letters, numbers, symbols)
        </p>
        <PinCircles
          label="PIN"
          labelledBy={`${id}-pin-label`}
          describedBy={`${id}-hint`}
          value={pin}
          reveal={reveal}
          onRevealChange={setReveal}
          autoFocus={autoFocus}
          onChange={(v) => {
            setPin(v);
            emit(v, again);
          }}
          onSubmit={() => confirmRow.current?.querySelector('input')?.focus()}
        />
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

      <div ref={confirmRow} className="flex flex-col gap-2">
        <p id={`${id}-again-label`} className="text-[12px] text-fg-muted">
          Confirm PIN
        </p>
        <PinCircles
          label="Confirm PIN"
          labelledBy={`${id}-again-label`}
          value={again}
          reveal={reveal}
          onChange={(v) => {
            setAgain(v);
            emit(pin, v);
          }}
          onSubmit={() => {
            if (matching) onSubmit?.();
          }}
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
