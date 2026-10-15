import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PIN_MAX, PIN_MIN } from '../../lib/app-lock';
import { cn } from '../../lib/cn';
import { useLockStore } from '../../stores/lock';
import { usePrefs } from '../../stores/prefs';
import { WindowControls } from '../shell/WindowControls';
import { AsciiBackdrop } from './AsciiBackdrop';

const secondsLeft = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

/**
 * The PIN prompt over the animated ASCII backdrop. The PIN is checked by the backend (Argon2id
 * in the desktop app); wrong attempts are delayed there, not here, so this screen only shows
 * the countdown it is given.
 */
export function LockScreen() {
  const unlock = useLockStore((s) => s.unlock);
  const lockedUntil = useLockStore((s) => s.lockedUntil);
  const failures = useLockStore((s) => s.failures);
  const name = usePrefs((s) => s.prefs.profile.name);

  const [pin, setPin] = useState('');
  const [shown, setShown] = useState(false);
  const [message, setMessage] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => secondsLeft(lockedUntil));
  const [forgetting, setForgetting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!forgetting && !busy && wait === 0) input.current?.focus();
  }, [forgetting, busy, wait]);

  const fail = (text: string) => {
    setMessage(text);
    setShake((n) => n + 1);
    setPin('');
  };

  const submit = async () => {
    if (busy || wait > 0 || pin.length === 0) return;
    setBusy(true);
    try {
      const result = await unlock(pin);
      if (result === 'wrong') fail('Wrong PIN.');
      else if (result === 'invalid') fail(`Use ${PIN_MIN} to ${PIN_MAX} characters.`);
      else if (result === 'wait') fail('Too many attempts.');
    } finally {
      setBusy(false);
    }
  };

  const locked = wait > 0;
  const typed = [...pin].length;
  const slots = Math.max(PIN_MIN, typed);

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-bg text-fg"
      onPointerDown={(e) => {
        if (!(e.target instanceof HTMLButtonElement)) input.current?.focus();
      }}
      data-testid="lock-screen"
    >
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

        <div
          key={shake}
          className={cn('flex items-center gap-3', shake > 0 && 'pin-shake')}
          aria-hidden="true"
        >
          {Array.from({ length: slots }, (_, i) => (
            <span
              key={i}
              className={cn(
                'size-3 rounded-full border transition-colors',
                i < typed ? 'border-accent bg-accent' : 'border-border-strong bg-transparent',
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={input}
            value={pin}
            disabled={busy || locked || forgetting}
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            autoFocus
            spellCheck={false}
            maxLength={PIN_MAX * 2}
            aria-labelledby="pin-prompt"
            aria-describedby="pin-message"
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setPin('');
                setMessage('');
              }
            }}
            className="h-9 w-56 rounded-control border border-border bg-surface/80 px-3 text-center font-mono text-[14px] tracking-widest text-fg outline-none backdrop-blur-sm focus:border-accent disabled:opacity-60"
          />
          <button
            type="button"
            aria-label={shown ? 'Hide PIN' : 'Show PIN'}
            aria-pressed={shown}
            onClick={() => setShown((v) => !v)}
            className="grid size-9 place-items-center rounded-control border border-border bg-surface/80 text-fg-muted hover:text-fg"
          >
            {shown ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <p
          id="pin-message"
          role="status"
          aria-live="polite"
          className="h-5 font-mono text-[12px] text-fg-muted"
        >
          {locked
            ? `Locked for ${wait}s after ${failures} wrong attempts.`
            : message || 'Press Enter to unlock.'}
        </p>

        <button
          type="button"
          className="mt-2 font-mono text-[11px] text-fg-subtle underline-offset-2 hover:text-fg-muted hover:underline"
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
