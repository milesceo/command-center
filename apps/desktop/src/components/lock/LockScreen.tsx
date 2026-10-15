import { useEffect, useState } from 'react';
import { PIN_MAX, PIN_MIN } from '../../lib/app-lock';
import { useLockStore } from '../../stores/lock';
import { usePrefs } from '../../stores/prefs';
import { PinCircles } from '../pin/PinCircles';
import { WindowControls } from '../shell/WindowControls';
import { Button } from '../ui/button';
import { AsciiBackdrop } from './AsciiBackdrop';

const secondsLeft = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

/**
 * The PIN prompt over the animated ASCII backdrop. The PIN is checked by the backend (Argon2id
 * in the desktop app); wrong attempts are delayed there, not here, so this screen only shows
 * the countdown it is given. The circles are the input (see `PinCircles`).
 */
export function LockScreen() {
  const unlock = useLockStore((s) => s.unlock);
  const lockedUntil = useLockStore((s) => s.lockedUntil);
  const failures = useLockStore((s) => s.failures);
  const name = usePrefs((s) => s.prefs.profile.name);

  const [pin, setPin] = useState('');
  // Per visit: leaving the screen unmounts this state, so the reveal always starts off.
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => secondsLeft(lockedUntil));
  const [forgetting, setForgetting] = useState(false);

  // Count down a lockout so the prompt re-enables itself.
  useEffect(() => {
    const first = setTimeout(() => setWait(secondsLeft(lockedUntil)), 0);
    if (lockedUntil <= Date.now()) return () => clearTimeout(first);
    const timer = setInterval(() => {
      const left = secondsLeft(lockedUntil);
      setWait(left);
      if (left === 0) clearInterval(timer);
    }, 500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [lockedUntil]);

  const locked = wait > 0;
  const typed = [...pin].length;

  const submit = async () => {
    if (busy || locked || typed < PIN_MIN) return;
    setBusy(true);
    try {
      const result = await unlock(pin);
      if (result === 'ok') return;
      // Wrong, or now waiting: shake, clear, and let the rate limiter's message show.
      setMessage(
        result === 'wrong'
          ? 'Wrong PIN.'
          : result === 'invalid'
            ? `Use ${PIN_MIN} to ${PIN_MAX} characters.`
            : 'Too many attempts.',
      );
      setShake((n) => n + 1);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-bg text-fg" data-testid="lock-screen">
      <AsciiBackdrop />
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-20 flex h-11 items-center justify-end px-4"
      >
        <WindowControls />
      </div>
      <form
        className="absolute inset-x-0 top-[48%] flex flex-col items-center gap-4 px-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="font-mono text-[13px] tracking-wide text-fg-muted" id="pin-prompt">
          {'> '}
          {name ? `Enter your PIN, ${name}` : 'Enter your PIN'}
          <span className="caret ml-1" aria-hidden="true" />
        </p>

        <PinCircles
          value={pin}
          onChange={setPin}
          onSubmit={() => void submit()}
          labelledBy="pin-prompt"
          describedBy="pin-message"
          disabled={busy || locked || forgetting}
          autoFocus
          keepFocus={!forgetting}
          shake={shake}
          reveal={reveal}
          onRevealChange={setReveal}
        />

        <p
          id="pin-message"
          role="status"
          aria-live="polite"
          className="h-5 font-mono text-[12px] text-fg-muted"
        >
          {locked
            ? `Locked for ${wait}s after ${failures} wrong attempts.`
            : message || `Enter ${PIN_MIN} to ${PIN_MAX} characters, then press Enter.`}
        </p>

        <Button
          type="submit"
          variant="primary"
          disabled={busy || locked || typed < PIN_MIN}
          className="min-w-28"
        >
          Unlock
        </Button>

        <button
          type="button"
          className="mt-1 font-mono text-[11px] text-fg-subtle underline-offset-2 hover:text-fg-muted hover:underline"
          onClick={() => setForgetting(true)}
        >
          forgot PIN?
        </button>
      </form>

      {forgetting && <ForgetPanel onCancel={() => setForgetting(false)} />}
    </div>
  );
}

/** The only way past a forgotten PIN: erase it together with every local chat and API key. */
function ForgetPanel({ onCancel }: { onCancel: () => void }) {
  const forget = useLockStore((s) => s.forgetEverything);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = text.trim().toUpperCase() === 'DELETE';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="forget-title"
      className="absolute inset-0 z-10 grid place-items-center bg-bg/80 p-6"
    >
      <div className="w-full max-w-sm rounded-panel border border-border-strong bg-elevated p-4 font-mono text-[12px]">
        <h2 id="forget-title" className="text-[13px] font-semibold">
          Forgot your PIN?
        </h2>
        <p className="mt-2 text-fg-muted">
          A PIN cannot be recovered; there is no account to reset it through. To get back in, Geeked
          erases the PIN and everything stored on this computer: conversations, prompts, projects,
          usage history, settings and saved API keys. Your Claude login is not touched. Geeked then
          starts setup again.
        </p>
        <label className="mt-3 block text-fg-subtle" htmlFor="forget-confirm">
          Type DELETE to confirm
        </label>
        <input
          id="forget-confirm"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-1 w-full rounded-control border border-border-strong bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
        {error && (
          <p role="alert" className="mt-2 text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-control border border-border px-3 py-1.5 hover:bg-hover"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            className="rounded-control bg-danger px-3 py-1.5 text-bg disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              setError('');
              void forget().catch((err: unknown) => {
                setBusy(false);
                setError(err instanceof Error ? err.message : 'Could not erase local data.');
              });
            }}
          >
            Erase and reset
          </button>
        </div>
      </div>
    </div>
  );
}
