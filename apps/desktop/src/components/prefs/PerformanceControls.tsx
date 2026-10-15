import { Check, X } from 'lucide-react';
import { useId } from 'react';
import { TIER_IDS, TIERS, summarizeTier } from '../../lib/performance';
import { usePrefs } from '../../stores/prefs';

/**
 * The five-tier performance slider with a live summary of what the chosen tier turns on and
 * off. The tier-to-flags mapping lives in `lib/performance.ts`.
 */
export function PerformanceControls() {
  const tier = usePrefs((s) => s.prefs.performance.tier);
  const setTier = usePrefs((s) => s.setTier);
  const id = useId();
  const index = TIER_IDS.indexOf(tier);
  const summary = summarizeTier(tier);

  return (
    <div className="flex flex-col gap-3" data-testid="performance-controls">
      <div>
        <label htmlFor={id} className="sr-only">
          Performance tier
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={TIER_IDS.length - 1}
          step={1}
          value={index}
          aria-valuetext={TIERS[tier].label}
          onChange={(e) => {
            const next = TIER_IDS[Number(e.target.value)];
            if (next) setTier(next);
          }}
          className="w-full accent-[var(--accent)]"
        />
        <div className="mt-1 flex justify-between text-[11px] text-fg-subtle" aria-hidden="true">
          {TIER_IDS.map((t) => (
            <span key={t} className={t === tier ? 'font-medium text-fg' : undefined}>
              {TIERS[t].label}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-control border border-border bg-bg p-3" aria-live="polite">
        <p className="text-[13px] font-medium">
          {TIERS[tier].label}
          <span className="font-normal text-fg-muted"> — {TIERS[tier].blurb}</span>
        </p>
        <ul className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
          {summary.on.map((text) => (
            <li key={text} className="flex items-center gap-1.5 text-fg">
              <Check size={12} className="shrink-0 text-success" aria-hidden="true" />
              {text}
            </li>
          ))}
          {summary.off.map((text) => (
            <li key={text} className="flex items-center gap-1.5 text-fg-subtle">
              <X size={12} className="shrink-0" aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
