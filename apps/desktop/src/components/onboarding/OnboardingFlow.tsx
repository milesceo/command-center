import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { checkName, NAME_MAX } from '../../lib/prefs';
import { cn } from '../../lib/cn';
import { useLockStore } from '../../stores/lock';
import { usePrefs } from '../../stores/prefs';
import { useUiStore } from '../../stores/ui';
import { AsciiBackdrop } from '../lock/AsciiBackdrop';
import { AppearanceControls } from '../prefs/AppearanceControls';
import { PerformanceControls } from '../prefs/PerformanceControls';
import { PinSetup } from '../prefs/PinSetup';
import { ProviderCards } from '../prefs/ProviderCards';
import { SystemControls } from '../prefs/SystemControls';
import { WindowControls } from '../shell/WindowControls';
import { Button } from '../ui/button';

interface StepDef {
  id: 'name' | 'pin' | 'system' | 'look' | 'agents';
  label: string;
  title: string;
  subtitle: string;
  /** Where the same choice lives in Settings, shown on screen to keep the flow low-pressure. */
  settings: string;
}

export const ONBOARDING_STEPS: readonly StepDef[] = [
  {
    id: 'name',
    label: 'Name',
    title: 'What should Command Center call you?',
    subtitle: 'Used for greetings. It stays on this computer.',
    settings: 'Settings → Profile',
  },
  {
    id: 'pin',
    label: 'PIN',
    title: 'Lock Command Center with a PIN',
    subtitle: 'Asked at launch and after a period of inactivity.',
    settings: 'Settings → Security',
  },
  {
    id: 'system',
    label: 'System',
    title: 'How should Command Center behave?',
    subtitle: 'Start at login, what the close button does, and when the AI helper stops.',
    settings: 'Settings → System',
  },
  {
    id: 'look',
    label: 'Look & feel',
    title: 'Performance and appearance',
    subtitle: 'Pick how much Command Center does, and how it looks.',
    settings: 'Settings → Performance and Settings → Appearance',
  },
  {
    id: 'agents',
    label: 'AI agents',
    title: 'Connect your AI agents',
    subtitle: 'Skip any you do not use. Claude is detected automatically.',
    settings: 'Settings → AI agents',
  },
];

function StepFrame({ def, children }: { def: StepDef; children: ReactNode }) {
  return (
    <section aria-labelledby="onboarding-title" className="flex flex-col gap-5">
      <header>
        <h1 id="onboarding-title" className="text-xl font-semibold tracking-tight">
          {def.title}
        </h1>
        <p className="mt-1 text-[13px] text-fg-muted">{def.subtitle}</p>
        <p className="mt-1 text-[11px] text-fg-subtle">
          You can change this any time in {def.settings}.
        </p>
      </header>
      {children}
    </section>
  );
}

function NameStep({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const checked = checkName(value);
  const touched = value.length > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="onboarding-name" className="text-[12px] text-fg-muted">
        Your name
      </label>
      <input
        id="onboarding-name"
        autoFocus
        value={value}
        autoComplete="given-name"
        maxLength={NAME_MAX * 4}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && checked.ok) {
            e.preventDefault();
            onSubmit();
          }
        }}
        className="selectable h-10 rounded-control border border-border bg-bg px-3 text-[15px] outline-none focus:border-accent"
        aria-describedby="onboarding-name-hint"
        aria-invalid={touched && !checked.ok}
      />
      <p
        id="onboarding-name-hint"
        className={cn('text-[11px]', touched && !checked.ok ? 'text-danger' : 'text-fg-subtle')}
      >
        {touched && !checked.ok ? checked.reason : `1 to ${NAME_MAX} characters.`}
      </p>
    </div>
  );
}

/**
 * First-run setup (and "Re-run onboarding" from Settings). Full window, keyboard friendly:
 * Enter continues, the step list is a roving-focus tab list, and every step can be revisited.
 * Each step writes straight to the prefs store, so closing the app mid-way keeps what was set.
 */
export function OnboardingFlow() {
  const savedStep = usePrefs((s) => s.prefs.onboarding.step);
  const savedName = usePrefs((s) => s.prefs.profile.name);
  const setStepPref = usePrefs((s) => s.setOnboardingStep);
  const hasPin = useLockStore((s) => s.hasPin);

  const [step, setStepState] = useState(() =>
    Math.min(Math.max(savedStep, 0), ONBOARDING_STEPS.length - 1),
  );
  const [name, setName] = useState(savedName);
  const [pin, setPin] = useState<string | null>(null);
  const [changingPin, setChangingPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const def = ONBOARDING_STEPS[step]!;
  const last = step === ONBOARDING_STEPS.length - 1;
  const nameOk = checkName(name).ok;

  const go = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), ONBOARDING_STEPS.length - 1);
    setError('');
    setStepState(clamped);
    setStepPref(clamped);
  };

  const finish = () => {
    usePrefs.getState().completeOnboarding();
    useUiStore.getState().setView('landing');
  };

  const saveName = () => {
    if (!usePrefs.getState().setName(name)) return false;
    return true;
  };

  const canContinue =
    def.id === 'name'
      ? nameOk
      : def.id === 'pin'
        ? hasPin && !changingPin
          ? true
          : pin !== null
        : true;

  const next = async () => {
    if (busy) return;
    setError('');
    if (def.id === 'name' && !saveName()) return;
    if (def.id === 'pin' && pin !== null && (!hasPin || changingPin)) {
      setBusy(true);
      try {
        await useLockStore.getState().setPin(pin);
        setPin(null);
        setChangingPin(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not set the PIN.');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (last) finish();
    else go(step + 1);
  };

  // Enter continues from anywhere that is not a button or a text area.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLButtonElement || t instanceof HTMLTextAreaElement) return;
      if (t instanceof HTMLInputElement && t.type === 'range') return;
      if (canContinue) {
        e.preventDefault();
        void next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    if (
      e.key !== 'ArrowDown' &&
      e.key !== 'ArrowRight' &&
      e.key !== 'ArrowUp' &&
      e.key !== 'ArrowLeft'
    )
      return;
    e.preventDefault();
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    const target = (index + delta + ONBOARDING_STEPS.length) % ONBOARDING_STEPS.length;
    tabs.current[target]?.focus();
  };

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden bg-bg text-fg" data-testid="onboarding">
      <div className="opacity-40" aria-hidden="true">
        <AsciiBackdrop />
      </div>
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-20 flex h-11 items-center justify-end px-4"
      >
        <WindowControls />
      </div>

      <div className="absolute inset-0 top-11 z-10 flex justify-center overflow-y-auto px-6 pb-8">
        <div className="mt-4 flex w-full max-w-4xl flex-col gap-6 md:flex-row">
          <nav aria-label="Setup steps" className="md:w-44 md:shrink-0">
            <ol role="tablist" aria-orientation="vertical" className="flex gap-1 md:flex-col">
              {ONBOARDING_STEPS.map((s, i) => {
                const active = i === step;
                const done = i < step;
                return (
                  <li key={s.id} role="presentation" className="flex-1 md:flex-none">
                    <button
                      ref={(el) => {
                        tabs.current[i] = el;
                      }}
                      role="tab"
                      type="button"
                      aria-selected={active}
                      aria-current={active ? 'step' : undefined}
                      tabIndex={active ? 0 : -1}
                      onKeyDown={(e) => onTabKey(e, i)}
                      onClick={() => {
                        if (i <= step || canContinue) {
                          if (def.id === 'name') saveName();
                          go(i);
                        }
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-control border px-2.5 py-2 text-left text-[12px] transition-colors',
                        active
                          ? 'border-accent bg-elevated text-fg'
                          : 'border-transparent text-fg-muted hover:bg-hover hover:text-fg',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-5 shrink-0 place-items-center rounded-full border text-[10px]',
                          done || active
                            ? 'border-accent bg-accent text-accent-fg'
                            : 'border-border-strong text-fg-subtle',
                        )}
                      >
                        {done ? <Check size={11} /> : i + 1}
                      </span>
                      <span className="hidden truncate md:inline">{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 hidden text-[11px] text-fg-subtle md:block">
              Step {step + 1} of {ONBOARDING_STEPS.length}
            </p>
          </nav>

          <main className="min-w-0 flex-1 rounded-panel border border-border bg-surface/90 p-6 backdrop-blur-sm">
            <StepFrame def={def}>
              {def.id === 'name' && (
                <NameStep value={name} onChange={setName} onSubmit={() => void next()} />
              )}

              {def.id === 'pin' && (
                <div className="flex flex-col gap-4">
                  {hasPin && !changingPin ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-control border border-border bg-bg p-3 text-[13px]">
                      <Check size={14} className="text-success" aria-hidden="true" />
                      <span>A PIN is already set.</span>
                      <Button size="sm" onClick={() => setChangingPin(true)}>
                        Choose a new PIN
                      </Button>
                    </div>
                  ) : (
                    <PinSetup onChange={setPin} onSubmit={() => void next()} autoFocus />
                  )}
                  <p className="rounded-control border border-border bg-bg p-3 text-[12px] text-fg-muted">
                    <strong className="font-medium text-fg">
                      There is no way to recover a PIN.
                    </strong>{' '}
                    Command Center has no account to reset it through. If you forget it, the only
                    way back in is to erase everything stored here: chats, prompts, settings and API
                    keys. The PIN is kept only as a salted Argon2id hash and is never stored itself,
                    and repeated wrong attempts are slowed down. It is a screen lock, not disk
                    encryption.
                  </p>
                  {!hasPin && (
                    <button
                      type="button"
                      className="w-fit text-[12px] text-fg-subtle underline-offset-2 hover:text-fg-muted hover:underline"
                      onClick={() => {
                        setPin(null);
                        go(step + 1);
                      }}
                    >
                      Skip for now (you can add a PIN in Settings)
                    </button>
                  )}
                </div>
              )}

              {def.id === 'system' && <SystemControls />}

              {def.id === 'look' && (
                <div className="flex flex-col gap-6">
                  <PerformanceControls />
                  <AppearanceControls />
                </div>
              )}

              {def.id === 'agents' && <ProviderCards />}

              {error && (
                <p role="alert" className="text-[12px] text-danger">
                  {error}
                </p>
              )}

              <footer className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-4">
                <Button onClick={() => go(step - 1)} disabled={step === 0}>
                  <ArrowLeft size={13} aria-hidden="true" />
                  Back
                </Button>
                <div className="flex items-center gap-3">
                  {last && (
                    <span className="hidden text-[11px] text-fg-subtle sm:inline">
                      Skipping agents is fine.
                    </span>
                  )}
                  <Button
                    variant="primary"
                    onClick={() => void next()}
                    disabled={!canContinue || busy}
                  >
                    {last ? 'Finish' : 'Next'}
                    {!last && <ArrowRight size={13} aria-hidden="true" />}
                  </Button>
                </div>
              </footer>
            </StepFrame>
          </main>
        </div>
      </div>
    </div>
  );
}
