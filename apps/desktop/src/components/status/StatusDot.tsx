import { STATUS_HISTORY_URL, feedProviderFor, type ProviderId } from '@command-center/protocol';
import { ExternalLink } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { openExternal } from '../../lib/external';
import { providerName } from '../../lib/providers';
import { STATUS_DOT, ago } from '../../lib/status-feed';
import { useStatus } from '../../stores/status';

interface Props {
  provider: ProviderId;
  /** Also print the state next to the dot. */
  withLabel?: boolean;
  /** Which edge the details panel hangs from; use `right` near the right side of the window. */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * A small status dot for one provider, from the AI status feed. Hover shows the summary; click
 * or Enter opens the incident details. With no feed yet the dot is grey ("status unknown").
 */
export function StatusDot({ provider, withLabel = false, align = 'left', className }: Props) {
  const feed = useStatus((s) => s.feed);
  const fetchedAt = useStatus((s) => s.fetchedAt);
  const source = useStatus((s) => s.source);
  const error = useStatus((s) => s.error);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  const entry = feed ? feedProviderFor(feed, provider) : null;
  const overall = entry?.status.overall ?? 'unknown';
  const style = STATUS_DOT[overall];
  const name = providerName(provider);
  const summary = entry ? entry.status.summary || style.label : 'No status feed yet';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={root} className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        aria-label={`${name} status: ${style.label}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`${name}: ${summary}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-6 items-center gap-1.5 rounded-control px-1 text-[11px] text-fg-muted hover:bg-hover hover:text-fg"
        data-testid={`status-dot-${provider}`}
        data-status={overall}
      >
        <span className={cn('size-2 shrink-0 rounded-full', style.className)} aria-hidden="true" />
        {withLabel && <span>{style.label}</span>}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`${name} status details`}
          className={cn(
            'absolute top-full z-40 mt-1 w-72 rounded-panel border border-border-strong bg-elevated p-3 text-left text-[12px] shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <p className="flex items-center gap-2 font-medium">
            <span className={cn('size-2 rounded-full', style.className)} aria-hidden="true" />
            {name}: {style.label}
          </p>
          <p className="mt-0.5 text-fg-muted">{summary}</p>

          {entry && entry.status.incidents.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {entry.status.incidents.map((incident) => (
                <li key={incident.id} className="rounded-control border border-border p-2">
                  <p className="font-medium">{incident.title}</p>
                  <p className="text-[11px] text-fg-subtle">
                    {incident.status.replace(/_/g, ' ')}
                    {incident.impact !== 'unknown' && incident.impact !== 'none'
                      ? ` · ${incident.impact}`
                      : ''}
                  </p>
                  {incident.url && (
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                      onClick={() => void openExternal(incident.url!)}
                    >
                      Incident details <ExternalLink size={10} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {entry && entry.status.affected_components.length > 0 && (
            <p className="mt-2 text-[11px] text-fg-subtle">
              Affected: {entry.status.affected_components.map((c) => c.name).join(', ')}
            </p>
          )}

          {entry?.status.state === 'error' && (
            <p className="mt-2 text-[11px] text-fg-subtle">
              The collector could not read this provider's status page, so the state is unknown.
            </p>
          )}

          <p className="mt-2 text-[11px] text-fg-subtle">
            {fetchedAt === null
              ? 'Waiting for the first status check.'
              : source === 'cache'
                ? `Offline: showing the copy from ${ago(fetchedAt)}.`
                : `Checked ${ago(fetchedAt)}.`}
            {error && source !== 'cache' ? ' The last refresh failed.' : ''}
          </p>

          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
            onClick={() => void openExternal(STATUS_HISTORY_URL)}
          >
            View status history <ExternalLink size={10} aria-hidden="true" />
          </button>
        </div>
      )}
    </span>
  );
}
