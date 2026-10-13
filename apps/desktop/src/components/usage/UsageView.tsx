import { Info } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { cn } from '../../lib/cn';
import { COST_LABEL, COST_NOTE, formatCost, formatTokens, formatUsd } from '../../lib/format';
import { totalTokens } from '../../lib/repo-usage';
import type { SeriesPoint } from '../../lib/usage-series';
import { usageStore, useUsage, type RangeDays } from '../../stores/usage';
import { BarList } from './BarList';
import { HeadroomCard } from './HeadroomCard';
import { StackedBars, type Column, type Series } from './StackedBars';

const TOKEN_SERIES: Series[] = [
  { key: 'output', label: 'Output', color: 'var(--series-2)' },
  { key: 'input', label: 'Input', color: 'var(--series-1)' },
  { key: 'cacheWrite', label: 'Cache write', color: 'var(--series-3)' },
  { key: 'cacheRead', label: 'Cache read', color: 'var(--series-4)' },
];
const COST_SERIES: Series[] = [{ key: 'cost', label: COST_LABEL, color: 'var(--series-1)' }];

const dayTitle = (p: SeriesPoint) =>
  p.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const shortDate = (p: SeriesPoint) =>
  p.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function toColumns(points: SeriesPoint[], metric: 'tokens' | 'cost', weekly: boolean): Column[] {
  return points.map((p) => ({
    key: p.bucket,
    label: shortDate(p),
    title: weekly ? `Week of ${shortDate(p)}` : dayTitle(p),
    values:
      metric === 'cost'
        ? { cost: p.costUsd ?? 0 }
        : {
            output: p.outputTokens,
            input: p.inputTokens,
            cacheWrite: p.cacheCreationTokens,
            cacheRead: p.cacheReadTokens,
          },
  }));
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-panel border border-border bg-surface px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] text-fg-subtle">
        {label}
        {hint && (
          <span title={hint} className="inline-flex" aria-label={hint}>
            <Info size={11} />
          </span>
        )}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

const RANGES: RangeDays[] = [7, 30, 90];

/** Everything about what has been used: plan headroom, totals, daily and weekly charts, models, top conversations. */
export function UsageView() {
  const { data, rangeDays, metric, loading, error } = useUsage((s) => s);

  useEffect(() => {
    const store = usageStore.getState();
    void store.load();
    void store.refreshReport();
  }, []);

  const dailyColumns = useMemo(
    () => (data ? toColumns(data.daily, metric, false) : []),
    [data, metric],
  );
  const weeklyColumns = useMemo(
    () => (data ? toColumns(data.weekly, metric, true) : []),
    [data, metric],
  );
  const series = metric === 'cost' ? COST_SERIES : TOKEN_SERIES;
  const costFormat = (v: number) => formatUsd(v);
  const format = metric === 'cost' ? costFormat : formatTokens;
  const totals = data?.totals;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="usage-view">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-semibold tracking-tight">Usage</h1>
          <div className="flex items-center gap-3">
            <div
              role="group"
              aria-label="Metric"
              className="flex rounded-control border border-border text-xs"
            >
              {(['tokens', 'cost'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={metric === m}
                  onClick={() => usageStore.getState().setMetric(m)}
                  className={cn(
                    'px-2.5 py-1 first:rounded-l-control last:rounded-r-control',
                    metric === m ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {m === 'tokens' ? 'Tokens' : COST_LABEL}
                </button>
              ))}
            </div>
            <div
              role="group"
              aria-label="Range"
              className="flex rounded-control border border-border text-xs"
            >
              {RANGES.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={rangeDays === d}
                  onClick={() => void usageStore.getState().setRange(d)}
                  className={cn(
                    'px-2.5 py-1 first:rounded-l-control last:rounded-r-control',
                    rangeDays === d ? 'bg-hover text-fg' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>
        </header>

        <HeadroomCard />

        {error && (
          <p role="alert" className="text-xs text-danger">
            Couldn't read usage: {error}
          </p>
        )}

        {totals && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="usage-totals">
            <Tile label="Replies" value={String(totals.replies)} />
            <Tile
              label="Tokens"
              value={formatTokens(totalTokens(totals))}
              hint="Input, output and cached tokens together."
            />
            <Tile label="Output tokens" value={formatTokens(totals.outputTokens)} />
            <Tile
              label={COST_LABEL}
              value={formatCost(totals.costUsd, totals.costComplete)}
              hint={COST_NOTE}
            />
          </div>
        )}

        {data && totals && totals.replies === 0 && !loading && (
          <p className="rounded-panel border border-dashed border-border p-6 text-center text-xs text-fg-subtle">
            No usage recorded in this range yet. Tokens are recorded from each finished reply the
            SDK reports.
          </p>
        )}

        {data && (
          <>
            <StackedBars
              title={`${metric === 'cost' ? COST_LABEL : 'Tokens'} per day`}
              format={format}
              series={series}
              columns={dailyColumns}
              {...(metric === 'cost' ? { note: COST_NOTE } : {})}
            />
            <StackedBars
              title={`${metric === 'cost' ? COST_LABEL : 'Tokens'} per week`}
              format={format}
              series={series}
              columns={weeklyColumns}
              note="Weeks start on Monday."
            />

            <section
              className="rounded-panel border border-border bg-surface p-3"
              aria-label="By model"
            >
              <h2 className="mb-2 text-xs font-medium">By model</h2>
              {data.models.length === 0 ? (
                <p className="text-xs text-fg-subtle">No model usage yet.</p>
              ) : (
                <BarList
                  label="Tokens by model"
                  items={data.models.map((m) => ({
                    key: m.model,
                    label: m.model,
                    value: metric === 'cost' ? (m.costUsd ?? 0) : totalTokens(m),
                    display:
                      metric === 'cost'
                        ? formatCost(m.costUsd, m.costComplete)
                        : formatTokens(totalTokens(m)),
                    title: `${m.replies} replies · in ${formatTokens(m.inputTokens)} · out ${formatTokens(m.outputTokens)} · cache write ${formatTokens(m.cacheCreationTokens)} · cache read ${formatTokens(m.cacheReadTokens)} · ${COST_LABEL} ${formatCost(m.costUsd, m.costComplete)}`,
                  }))}
                />
              )}
            </section>

            <section
              className="rounded-panel border border-border bg-surface p-3"
              aria-label="Top conversations"
            >
              <h2 className="mb-2 text-xs font-medium">Top conversations</h2>
              {data.top.length === 0 ? (
                <p className="text-xs text-fg-subtle">No conversations yet.</p>
              ) : (
                <BarList
                  label="Tokens by conversation"
                  items={data.top.map((c) => ({
                    key: c.conversationId ?? 'none',
                    label: c.title ?? 'Deleted conversation',
                    dim: c.title === null,
                    value: metric === 'cost' ? (c.costUsd ?? 0) : totalTokens(c),
                    display:
                      metric === 'cost'
                        ? formatCost(c.costUsd, c.costComplete)
                        : formatTokens(totalTokens(c)),
                    title: `${c.replies} replies · in ${formatTokens(c.inputTokens)} · out ${formatTokens(c.outputTokens)} · cache ${formatTokens(c.cacheReadTokens + c.cacheCreationTokens)}`,
                  }))}
                />
              )}
            </section>

            <p className="pb-4 text-[11px] text-fg-subtle">
              Tokens come from the usage the SDK reports with each finished reply. Replies you stop
              part-way are not counted, because the SDK sends no usage for them. {COST_LABEL} is
              informational, not a bill.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
