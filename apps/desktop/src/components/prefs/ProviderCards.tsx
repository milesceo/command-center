import { PROVIDER_IDS, type ProviderId } from '@geeked/protocol';
import { Check, KeyRound, Loader2, Plus, RefreshCw, Terminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { PROVIDER_META, connectionState, type ConnectionState } from '../../lib/providers';
import { secrets } from '../../lib/secrets';
import { usePrefs } from '../../stores/prefs';
import { useProviders } from '../../stores/providers';
import { toast } from '../../stores/toast';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';

const BADGES: Record<ConnectionState, { text: string; className: string }> = {
  connected: { text: 'Connected', className: 'bg-success/15 text-fg' },
  needs_signin: { text: 'Sign-in needed', className: 'bg-warning/15 text-fg' },
  not_installed: { text: 'CLI not installed', className: 'bg-hover text-fg-muted' },
  unknown: { text: 'Not checked', className: 'bg-hover text-fg-muted' },
  off: { text: 'Not connected', className: 'bg-hover text-fg-muted' },
};

/** Polls the providers while the user completes a sign-in in the terminal window. */
function useSignInWatch(id: ProviderId) {
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setWaiting(false);
  };

  useEffect(() => () => stop(), []);

  const start = () => {
    stop();
    setWaiting(true);
    let ticks = 0;
    timer.current = setInterval(() => {
      ticks += 1;
      void useProviders
        .getState()
        .refresh()
        .then(() => {
          const info = useProviders.getState().infos[id];
          if (info?.auth === 'signed_in' || ticks >= 40) stop();
        });
    }, 3000);
  };

  return { waiting, start, stop };
}

function ApiKeyForm({ id }: { id: ProviderId }) {
  const hasKey = useProviders((s) => s.hasKey[id]);
  const saveKey = useProviders((s) => s.saveKey);
  const removeKey = useProviders((s) => s.removeKey);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const meta = PROVIDER_META[id];

  if (!secrets.available()) {
    return (
      <p className="text-[11px] text-fg-subtle">
        API keys are stored in the Windows Credential Manager, so adding one needs the desktop app.
      </p>
    );
  }

  if (hasKey) {
    return (
      <div className="flex items-center gap-2 text-[12px]">
        <KeyRound size={12} className="text-success" aria-hidden="true" />
        <span className="text-fg-muted">API key saved in Windows Credential Manager.</span>
        <Button size="sm" onClick={() => void removeKey(id)}>
          Remove key
        </Button>
      </div>
    );
  }

  const save = async () => {
    if (value.trim() === '') return;
    setBusy(true);
    try {
      await saveKey(id, value);
      setValue('');
      toast(`${meta.name} key saved`);
    } catch (err) {
      toast(`Could not save the key: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="text-[11px] text-fg-subtle" htmlFor={`key-${id}`}>
        {meta.name} API key {meta.keyHint ? `· ${meta.keyHint}` : ''}
      </label>
      <div className="flex gap-2">
        <input
          id={`key-${id}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste key"
          className="h-8 min-w-0 flex-1 rounded-control border border-border bg-bg px-2 font-mono text-[12px] outline-none focus:border-accent"
        />
        <Button type="submit" size="sm" variant="primary" disabled={busy || value.trim() === ''}>
          Save key
        </Button>
      </div>
      <p className="text-[11px] text-fg-subtle">
        Stored only in the Windows Credential Manager, never in Geeked's database or files.
      </p>
    </form>
  );
}

function ProviderCard({ id }: { id: ProviderId }) {
  const meta = PROVIDER_META[id];
  const info = useProviders((s) => s.infos[id]);
  const hasKey = useProviders((s) => s.hasKey[id]);
  const connection = usePrefs((s) => s.prefs.providers.connections[id]);
  const setConnection = usePrefs((s) => s.setConnection);
  const watch = useSignInWatch(id);
  const [opening, setOpening] = useState(false);

  const state = connectionState(info, hasKey, connection.method);
  const badge = BADGES[state];

  const signIn = async () => {
    setOpening(true);
    try {
      await useProviders.getState().login(id);
      setConnection(id, { enabled: true, method: 'subscription' });
      watch.start();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  };

  const subscriptionConnected = info?.auth === 'signed_in' && info.authVia !== 'apiKey';
  // Claude is detected, not configured: a working login turns it on by itself.
  useEffect(() => {
    if (id === 'claude' && subscriptionConnected && connection.method === null) {
      setConnection('claude', { enabled: true, method: 'subscription' });
    }
  }, [id, subscriptionConnected, connection.method, setConnection]);

  return (
    <li
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-3"
      data-testid={`provider-${id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            {meta.name}
            <span
              className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', badge.className)}
            >
              {badge.text}
            </span>
          </p>
          <p className="mt-0.5 text-[12px] text-fg-muted">{meta.summary}</p>
        </div>
        <Switch
          label={`Offer ${meta.name} in the model picker`}
          checked={connection.enabled}
          onChange={(enabled) => setConnection(id, { enabled })}
        />
      </div>

      <p className="text-[11px] text-fg-subtle">{meta.limit}</p>

      {meta.supportsSubscription && state !== 'connected' && (
        <div className="flex flex-wrap items-center gap-2">
          {state === 'not_installed' ? (
            <p className="text-[12px] text-fg-muted">
              Install the official CLI, then sign in:{' '}
              <code className="font-mono text-[11px]">{meta.loginCommand}</code>
            </p>
          ) : (
            <Button size="sm" onClick={() => void signIn()} disabled={opening || watch.waiting}>
              {opening || watch.waiting ? (
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                <Terminal size={12} aria-hidden="true" />
              )}
              {watch.waiting ? 'Waiting for sign-in…' : `Sign in with ${meta.name} CLI`}
            </Button>
          )}
          {meta.loginCommand && state !== 'not_installed' && (
            <span className="text-[11px] text-fg-subtle">
              Opens a terminal running <code className="font-mono">{meta.loginCommand}</code>.
            </span>
          )}
        </div>
      )}

      {state === 'connected' && (
        <p className="flex items-center gap-1.5 text-[12px] text-fg-muted">
          <Check size={12} className="text-success" aria-hidden="true" />
          {info?.authVia === 'apiKey' || connection.method === 'apiKey'
            ? 'Using your API key.'
            : 'Signed in with your subscription.'}
        </p>
      )}

      {meta.supportsApiKey && <ApiKeyForm id={id} />}
    </li>
  );
}

/** Cards for every provider, plus the "Add another" placeholder. Used by onboarding and Settings. */
export function ProviderCards() {
  const refresh = useProviders((s) => s.refresh);
  const loading = useProviders((s) => s.loading);
  const error = useProviders((s) => s.error);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-3" data-testid="provider-cards">
      <ul className="grid gap-3 sm:grid-cols-2">
        {PROVIDER_IDS.map((id) => (
          <ProviderCard key={id} id={id} />
        ))}
        <li
          className="flex min-h-[7rem] flex-col items-center justify-center gap-1 rounded-panel border border-dashed border-border-strong p-3 text-center text-fg-subtle"
          data-testid="provider-add"
        >
          <Plus size={16} aria-hidden="true" />
          <p className="text-[12px] font-medium text-fg-muted">Add another</p>
          <p className="text-[11px]">More providers plug in through the same interface later.</p>
        </li>
      </ul>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw
            size={12}
            className={loading ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
          Check again
        </Button>
        {error && (
          <p role="status" className="text-[11px] text-fg-subtle">
            Could not check providers: {error}
          </p>
        )}
      </div>
    </div>
  );
}
