import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { formatReset } from '../../lib/errors';
import { formatAgo, formatPercent } from '../../lib/format';
import type { StoredWindow } from '../../lib/repo-usage';
import { headroom, sortWindows, type Severity } from '../../lib/usage-windows';
import { useUsage, usageStore } from '../../stores/usage';
import { Button } from '../ui/button';

const NO_WINDOWS: StoredWindow[] = [];

/** Current time, refreshed every 30 s so "resets in" stays right while the view is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const FILL: Record<Severity, string> = {
  ok: 'var(--accent)',
  warning: 'var(--warning)',
  critical: 'var(--danger)',
};

const SEVERITY_TEXT: Record<Severity, string | null> = {
  ok: null,
  warning: 'Getting high',
  critical: 'Almost used up',
};

/** The track is a lighter step of the accent so the unfilled part still reads as part of the same meter. */
function Meter({
  used,
  severity,
  label,
}: {
  used: number | null;
  severity: Severity;
  label: string;
}) {
  const pct = used === null ? 0 : Math.min(100, Math.round(used * 100));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(used === null ? {} : { 'aria-valuenow': pct })}
      className="h-2 overflow-hidden rounded-full"
      style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)' }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: FILL[severity] }}
      />
    </div>
  );
}

/**
 * Remaining plan headroom, exactly as the SDK reported it. Each window shows when it was
 * read; a reading from before the window last reset is flagged instead of extrapolated.
 */
export function HeadroomCard() {
  const data = useUsage((s) => s.data);
  const windows = data?.windows ?? NO_WINDOWS;
  const report = useUsage((s) => s.report);
  const now = useNow();
  const rows = sortWindows(windows).map((w) => headroom(w, now));

  return (
    <section
      className="rounded-panel border border-border bg-surface p-3"
      aria-label="Plan headroom"
    >
      <header className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-medium">Plan headroom</h2>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Your Claude subscription limits, as reported by the SDK.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => void usageStore.getState().refreshReport()}
          disabled={report.status === 'loading'}
        >
          <RefreshCw
            size={12}
            className={report.status === 'loading' ? 'animate-spin' : undefined}
          />
          Refresh
        </Button>
      </header>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map(({ window: w, used, remaining, stale, severity }) => (
            <li key={w.key} data-window={w.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium">{w.label}</span>
                <span className="text-fg-muted tabular-nums">
                  {stale
                    ? 'reading is out of date'
                    : remaining === null
                      ? 'usage not reported'
                      : `${formatPercent(remaining)} left (${formatPercent(used ?? 0)} used)`}
                </span>
              </div>
              <Meter used={stale ? null : used} severity={severity} label={`${w.label} used`} />
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-fg-subtle">
                {SEVERITY_TEXT[severity] && (
                  <span className="flex items-center gap-1 text-fg-muted">
                    <TriangleAlert size={11} />
                    {SEVERITY_TEXT[severity]}
                  </span>
                )}
                {w.resetsAt !== null && (
                  <span>
                    {stale ? 'reset' : 'resets'} {formatReset(w.resetsAt, now)}
                  </span>
                )}
                <span>
                  read {formatAgo(w.observedAt, now)}
                  {w.source === 'chat' ? ' (from a reply)' : ''}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {rows.length === 0 && report.status !== 'loading' && (
        <p className="text-xs text-fg-muted" data-testid="headroom-empty">
          {report.status === 'ready' && !report.available
            ? "Plan usage windows aren't available for this login (an API key, a third-party provider, or a login without profile access)."
            : report.status === 'error'
              ? `Couldn't read plan usage: ${report.message}`
              : 'No plan usage reported yet. The SDK attaches it to replies and to the Refresh button; it appears after your next message if your login has it.'}
        </p>
      )}
      {rows.length > 0 && report.status === 'error' && (
        <p className="mt-3 text-[11px] text-warning">
          Couldn't refresh: {report.message}. Showing the last readings.
        </p>
      )}
      {report.status === 'ready' && report.available && report.extraUsage?.enabled && (
        <p className="mt-3 text-[11px] text-fg-subtle">
          Extra usage is on
          {report.extraUsage.usedCredits !== null && report.extraUsage.monthlyLimit !== null
            ? `: ${report.extraUsage.usedCredits} of ${report.extraUsage.monthlyLimit} ${report.extraUsage.currency ?? ''} used this month`
            : '.'}
        </p>
      )}
      {report.status === 'ready' && report.subscriptionType && (
        <p className={cn('text-[11px] text-fg-subtle', rows.length > 0 && 'mt-1')}>
          Plan: {report.subscriptionType}
        </p>
      )}
    </section>
  );
}
