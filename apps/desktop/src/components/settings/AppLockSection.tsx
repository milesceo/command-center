import { useState } from 'react';
import { PIN_MAX, PIN_MIN } from '../../lib/app-lock';
import { AUTO_LOCK_CHOICES, type AutoLockMinutes } from '../../lib/prefs';
import { useLockStore } from '../../stores/lock';
import { usePrefs } from '../../stores/prefs';
import { toast } from '../../stores/toast';
import { PinSetup } from '../prefs/PinSetup';
import { Button } from '../ui/button';
import { Segmented } from '../ui/segmented';
import { Row, Section } from './parts';

type Mode = 'idle' | 'add' | 'change' | 'remove';

const AUTO_LABELS: Record<AutoLockMinutes, string> = {
  0: 'Off',
  1: '1 min',
  5: '5 min',
  15: '15 min',
  30: '30 min',
  60: '1 h',
};

/** Settings card for the app lock: set, change or remove the PIN, and pick the idle timeout. */
export function AppLockSection() {
  const hasPin = useLockStore((s) => s.hasPin);
  const autoLock = usePrefs((s) => s.prefs.security.autoLockMinutes);
  const setAutoLock = usePrefs((s) => s.setAutoLock);
  const [mode, setMode] = useState<Mode>('idle');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Remount the entry fields after each attempt so they clear.
  const [attempt, setAttempt] = useState(0);

  const reset = () => {
    setMode('idle');
    setCurrent('');
    setNext(null);
    setError('');
    setAttempt((n) => n + 1);
  };

  const submit = async () => {
    const lock = useLockStore.getState();
    setBusy(true);
    setError('');
    try {
      if (mode === 'add') {
        if (next === null) return;
        await lock.setPin(next);
        toast('PIN set');
      } else if (mode === 'change') {
        if (next === null) return;
        const result = await lock.changePin(current, next);
        if (result === 'wait') return setError('Too many wrong attempts. Wait and try again.');
        if (result !== 'ok') return setError('The current PIN is wrong.');
        toast('PIN changed');
      } else if (mode === 'remove') {
        const result = await lock.removePin(current);
        if (result === 'wait') return setError('Too many wrong attempts. Wait and try again.');
        if (result !== 'ok') return setError('That PIN is wrong.');
        toast('PIN removed');
      }
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const needsCurrent = mode === 'change' || mode === 'remove';
  const needsNew = mode === 'add' || mode === 'change';
  const ready = (!needsCurrent || current.length > 0) && (!needsNew || next !== null);

  return (
    <Section
      title="Security"
      hint="A PIN screen when Geeked starts or sits idle. It keeps casual snoopers out; it does not encrypt your chats on disk."
    >
      {!hasPin && mode === 'idle' && (
        <Row label="PIN" hint="No PIN is set, so Geeked opens straight to Home.">
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
              onChange={setAutoLock}
            />
          </Row>
          <Row label="PIN" hint="Locking is also on Ctrl+L, the tray menu and the command palette.">
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
          <p className="text-[11px] text-fg-subtle">
            Forgot it? The lock screen's "forgot PIN" erases all local data and starts setup again,
            because there is no account to recover through.
          </p>
        </>
      )}

      {mode !== 'idle' && (
        <form
          key={attempt}
          className="flex max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {needsCurrent && (
            <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
              Current PIN
              <input
                type="password"
                autoComplete="off"
                autoFocus
                maxLength={PIN_MAX * 2}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="h-9 rounded-control border border-border bg-bg px-3 font-mono text-[14px] tracking-widest text-fg outline-none focus:border-accent"
              />
            </label>
          )}
          {needsNew && <PinSetup onChange={setNext} autoFocus={!needsCurrent} />}
          <p className="text-[11px] text-fg-subtle">
            {PIN_MIN} to {PIN_MAX} characters. Stored only as a salted Argon2id hash.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={!ready || busy}>
              {mode === 'add' ? 'Set PIN' : mode === 'change' ? 'Change PIN' : 'Remove PIN'}
            </Button>
            <Button size="sm" onClick={reset}>
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-[11px] text-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </Section>
  );
}
