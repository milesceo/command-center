import { useState } from 'react';
import { isValidPin, PIN_MAX, PIN_MIN } from '../../lib/app-lock';
import { AUTO_LOCK_CHOICES, useLockStore, type AutoLockMinutes } from '../../stores/lock';
import { toast } from '../../stores/toast';
import { Button } from '../ui/button';
import { Segmented } from '../ui/segmented';
import { Row, Section } from './parts';

type Mode = 'idle' | 'add' | 'change' | 'remove';

const AUTO_LABELS: Record<AutoLockMinutes, string> = {
  0: 'Off',
  5: '5 min',
  15: '15 min',
  30: '30 min',
  60: '1 h',
};

function PinField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-fg-subtle">
      {label}
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))}
        className="h-8 w-36 rounded-control border border-border bg-bg px-2 font-mono text-[13px] tracking-widest text-fg outline-none focus:border-accent"
      />
    </label>
  );
}

/** Settings card for the app lock: set, change or remove the PIN, and pick the idle timeout. */
export function AppLockSection() {
  const hasPin = useLockStore((s) => s.hasPin);
  const autoLock = useLockStore((s) => s.autoLockMinutes);
  const [mode, setMode] = useState<Mode>('idle');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setMode('idle');
    setCurrent('');
    setNext('');
    setAgain('');
    setError('');
  };

  const submit = async () => {
    const lock = useLockStore.getState();
    if (mode === 'add' || mode === 'change') {
      if (!isValidPin(next)) return setError(`Use ${PIN_MIN} to ${PIN_MAX} digits.`);
      if (next !== again) return setError('The new PINs do not match.');
    }
    if (mode === 'add') {
      await lock.addPin(next);
      toast('PIN set');
    } else if (mode === 'change') {
      if (!(await lock.changePin(current, next))) return setError('The current PIN is wrong.');
      toast('PIN changed');
    } else if (mode === 'remove') {
      if (!(await lock.removePin(current))) return setError('That PIN is wrong.');
      toast('PIN removed');
    }
    reset();
  };

  return (
    <Section
      title="App lock"
      hint="A PIN screen when Geeked starts or sits idle. It keeps casual snoopers out; it does not encrypt your chats on disk."
    >
      {!hasPin && mode === 'idle' && (
        <Row label="PIN" hint="No PIN is set, so Geeked opens straight to your threads.">
          <Button size="sm" onClick={() => setMode('add')}>
            Set a PIN
          </Button>
        </Row>
      )}

      {hasPin && mode === 'idle' && (
        <>
          <Row label="Lock after inactivity" hint="Checked while the app is open.">
            <Segmented
              label="Lock after inactivity"
              value={autoLock}
              options={AUTO_LOCK_CHOICES.map((m) => ({ value: m, label: AUTO_LABELS[m] }))}
              onChange={(m) => useLockStore.getState().setAutoLock(m)}
            />
          </Row>
          <Row label="PIN" hint="Locking is also on Ctrl+L and in the command palette.">
            <span className="flex items-center gap-2">
              <Button size="sm" onClick={() => useLockStore.getState().lock()}>
                Lock now
              </Button>
              <Button size="sm" onClick={() => setMode('change')}>
                Change PIN
              </Button>
              <Button size="sm" onClick={() => setMode('remove')}>
                Remove PIN
              </Button>
            </span>
          </Row>
        </>
      )}

      {mode !== 'idle' && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {(mode === 'change' || mode === 'remove') && (
            <PinField label="Current PIN" value={current} onChange={setCurrent} />
          )}
          {(mode === 'add' || mode === 'change') && (
            <>
              <PinField label="New PIN" value={next} onChange={setNext} />
              <PinField label="Repeat new PIN" value={again} onChange={setAgain} />
            </>
          )}
          <Button type="submit" variant="primary" size="sm">
            {mode === 'add' ? 'Set PIN' : mode === 'change' ? 'Change PIN' : 'Remove PIN'}
          </Button>
          <Button size="sm" onClick={reset}>
            Cancel
          </Button>
          {error && (
            <p role="alert" className="w-full text-[11px] text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </Section>
  );
}
