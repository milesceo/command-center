import { useEffect, useRef, useState } from 'react';
import { isValidPin, PIN_MAX, PIN_MIN } from '../../lib/app-lock';
import { cn } from '../../lib/cn';
import { useLockStore } from '../../stores/lock';
import { WindowControls } from '../shell/WindowControls';
import { AsciiBackdrop } from './AsciiBackdrop';

type Mode = 'setup' | 'unlock';

const secondsLeft = (until: number) => Math.max(0, Math.ceil((until - Date.now()) / 1000));

/**
 * The landing page: animated ASCII with a PIN prompt. First launch asks the user to choose a
 * PIN (twice); afterwards it asks for it. Keyboard only: digits, Enter, Backspace, Escape.
 */
export function LockScreen({ mode }: { mode: Mode }) {
  const setup = useLockStore((s) => s.setup);
  const unlock = useLockStore((s) => s.unlock);
  const skip = useLockStore((s) => s.skip);
  const lockedUntil = useLockStore((s) => s.lockedUntil);
  const failures = useLockStore((s) => s.failures);

  const [pin, setPin] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(() => secondsLeft(lockedUntil));
  const [forgetting, setForgetting] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Count down a lockout so the prompt re-enables itself.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const left = secondsLeft(lockedUntil);
      setWait(left);
      if (left === 0) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  useEffect(() => {
    if (!forgetting) input.current?.focus();
  }, [forgetting, first, busy]);

  const confirming = mode === 'setup' && first !== null;
  const prompt =
    mode === 'unlock'
      ? 'Enter your PIN'
      : confirming
        ? 'Confirm your PIN'
        : `Choose a PIN (${PIN_MIN} to ${PIN_MAX} digits)`;

  const fail = (text: string) => {
    setMessage(text);
    setShake((n) => n + 1);
    setPin('');
  };

  const submit = async () => {
    if (busy || wait > 0) return;
    if (!isValidPin(pin)) {
      fail(`Use ${PIN_MIN} to ${PIN_MAX} digits.`);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'setup') {
        if (first === null) {
          setFirst(pin);
          setPin('');
          setMessage('');
        } else if (first !== pin) {
          setFirst(null);
          fail('The PINs did not match. Choose again.');
        } else {
          await setup(pin);
        }
        return;
      }
      const result = await unlock(pin);
      if (result === 'wrong') fail('Wrong PIN.');
      else if (result === 'invalid') fail(`Use ${PIN_MIN} to ${PIN_MAX} digits.`);
      else if (result === 'wait') {
        setWait(secondsLeft(useLockStore.getState().lockedUntil));
        fail('Too many attempts.');
      }
    } finally {
      setBusy(false);
    }
  };

  // Fallback for webviews where the hidden input never takes focus: when a key lands anywhere
  // else, drive the same state from the window. When the input has focus it handles the key.
  useEffect(() => {
    if (forgetting) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) {
        setPin((p) => (p + e.key).slice(0, PIN_MAX));
      } else if (e.key === 'Backspace') {
        setPin((p) => p.slice(0, -1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      } else if (e.key === 'Escape') {
        setPin('');
        setMessage('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [forgetting, submit]);

  const locked = wait > 0;
  const slots = Math.max(PIN_MIN, pin.length);

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-bg text-fg"
      onPointerDown={() => input.current?.focus()}
      data-testid="lock-screen"
    >
      <AsciiBackdrop />
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-20 flex h-11 items-center justify-end px-4"
      >
        <WindowControls />
      </div>
      <div className="absolute inset-x-0 top-[48%] flex flex-col items-center gap-4 px-6">
        <p className="font-mono text-[13px] tracking-wide text-fg-muted" id="pin-prompt">
          {'> '}
          {prompt}
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
                i < pin.length ? 'border-accent bg-accent' : 'border-border-strong bg-transparent',
              )}
            />
          ))}
        </div>

        <input
          ref={input}
          value={pin}
          disabled={busy || locked || forgetting}
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={PIN_MAX}
          type="password"
          aria-labelledby="pin-prompt"
          aria-describedby="pin-message"
          className="absolute size-px opacity-0"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') {
              setPin('');
              setMessage('');
            }
          }}
        />

        <p
          id="pin-message"
          role="status"
          aria-live="polite"
          className="h-5 font-mono text-[12px] text-fg-muted"
        >
          {locked
            ? `Locked for ${wait}s after ${failures} wrong attempts.`
            : message ||
              (mode === 'unlock' ? 'Press Enter to unlock.' : 'Press Enter to continue.')}
        </p>

        <div className="mt-2 flex items-center gap-4 font-mono text-[11px] text-fg-subtle">
          {mode === 'setup' && (
            <button
              type="button"
              className="underline-offset-2 hover:text-fg-muted hover:underline"
              onClick={skip}
            >
              continue without a PIN
            </button>
          )}
          {mode === 'unlock' && (
            <button
              type="button"
              className="underline-offset-2 hover:text-fg-muted hover:underline"
              onClick={() => setForgetting(true)}
            >
              forgot PIN?
            </button>
          )}
        </div>
      </div>

      {forgetting && <ForgetPanel onCancel={() => setForgetting(false)} />}
    </div>
  );
}

/** The only way past a forgotten PIN: erase it together with every local chat. */
function ForgetPanel({ onCancel }: { onCancel: () => void }) {
  const forget = useLockStore((s) => s.forgetEverything);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
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
          A PIN cannot be recovered. To get back in, Geeked erases the PIN and every conversation,
          prompt and project stored on this computer. Your Claude login is not touched.
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
              void forget();
            }}
          >
            Erase and reset
          </button>
        </div>
      </div>
    </div>
  );
}
