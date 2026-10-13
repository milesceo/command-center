import { useState } from 'react';
import { cn } from '../../lib/cn';
import { niceTicks, stackSegments } from '../../lib/chart-math';
import { useElementWidth } from '../../lib/use-element-width';

export interface Series {
  key: string;
  label: string;
  /** CSS color, normally `var(--series-N)`. */
  color: string;
}

export interface Column {
  key: string;
  /** Short axis label. */
  label: string;
  /** Tooltip heading. */
  title: string;
  values: Record<string, number>;
}

interface Props {
  title: string;
  /** What a value is, for the axis, tooltip and table (e.g. tokens). */
  format: (value: number) => string;
  series: Series[];
  columns: Column[];
  /** Series start visible; the legend toggles them. */
  note?: string;
}

const HEIGHT = 220;
const MARGIN = { top: 14, right: 8, bottom: 24, left: 46 };
const MAX_BAR = 24;
const FALLBACK_WIDTH = 640;

/**
 * Stacked columns: thin (<= 24 px) bars with a 4 px rounded top, 2 px surface gaps
 * between segments, hairline grid, text in text tokens (never series colors), and a
 * legend that doubles as a visibility toggle. Every figure is also available as a
 * table, and as a tooltip on hover.
 */
export function StackedBars({ title, format, series, columns, note }: Props) {
  const [ref, measured] = useElementWidth();
  const width = measured || FALLBACK_WIDTH;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const visible = series.filter((s) => !hidden.has(s.key));
  const totalOf = (c: Column) => visible.reduce((sum, s) => sum + (c.values[s.key] ?? 0), 0);
  const max = Math.max(0, ...columns.map(totalOf));
  const ticks = niceTicks(max);
  const axisMax = ticks[ticks.length - 1] ?? 1;

  const plotW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = plotW / Math.max(1, columns.length);
  const barW = Math.min(MAX_BAR, slot * 0.7);
  // Thin the x labels so they never touch.
  const labelEvery = Math.max(1, Math.ceil(56 / slot));
  const tallest = columns.reduce(
    (best, c, i) => (totalOf(c) > totalOf(columns[best] as Column) ? i : best),
    0,
  );

  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (visible.length > 1) next.add(key); // never hide the last series
      return next;
    });

  const hovered = hover !== null ? columns[hover] : undefined;

  return (
    <figure className="rounded-panel border border-border bg-surface p-3" aria-label={title}>
      <figcaption className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{title}</span>
        <button
          type="button"
          className="text-xs text-fg-muted hover:text-fg"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? 'Chart' : 'Table'}
        </button>
      </figcaption>

      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label="Series">
          {series.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={!hidden.has(s.key)}
              onClick={() => toggle(s.key)}
              className={cn(
                'flex items-center gap-1.5 text-xs',
                hidden.has(s.key) ? 'text-fg-subtle line-through' : 'text-fg-muted hover:text-fg',
              )}
            >
              <span
                className="size-2.5 rounded-sm"
                style={{
                  background: hidden.has(s.key) ? 'transparent' : s.color,
                  border: `1px solid ${s.color}`,
                }}
              />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {asTable ? (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface text-left text-fg-subtle">
              <tr>
                <th className="py-1 pr-3 font-medium">
                  {title.includes('week') ? 'Week of' : 'Day'}
                </th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
                {series.length > 1 && <th className="py-1 text-right font-medium">Total</th>}
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.key} className="border-t border-border/60">
                  <td className="py-1 pr-3 text-fg-muted">{c.title}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-3 text-right tabular-nums">
                      {format(c.values[s.key] ?? 0)}
                    </td>
                  ))}
                  {series.length > 1 && (
                    <td className="py-1 text-right tabular-nums">
                      {format(series.reduce((sum, s) => sum + (c.values[s.key] ?? 0), 0))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${title}. Open the table view for exact figures.`}
          >
            {ticks.map((t) => {
              const y = MARGIN.top + plotH - (t / axisMax) * plotH;
              return (
                <g key={t}>
                  <line
                    x1={MARGIN.left}
                    x2={width - MARGIN.right}
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                  <text
                    x={MARGIN.left - 6}
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize={10}
                    fill="var(--fg-subtle)"
                  >
                    {format(t)}
                  </text>
                </g>
              );
            })}

            {columns.map((c, i) => {
              const x = MARGIN.left + i * slot + (slot - barW) / 2;
              const segments = stackSegments(
                visible.map((s) => ({ key: s.key, value: c.values[s.key] ?? 0 })),
                axisMax,
                plotH,
              );
              return (
                <g key={c.key} transform={`translate(${x},${MARGIN.top})`}>
                  {hover === i && (
                    <rect
                      x={-(slot - barW) / 2}
                      y={0}
                      width={slot}
                      height={plotH}
                      fill="var(--hover)"
                    />
                  )}
                  {segments.map((seg, k) => {
                    const color = series.find((s) => s.key === seg.key)?.color ?? 'var(--series-1)';
                    const isTop = k === segments.length - 1;
                    const r = Math.min(4, barW / 2, seg.height);
                    // Rounded data end on the top segment, square everywhere else (and at the baseline).
                    const d = isTop
                      ? `M0 ${seg.y + seg.height} V${seg.y + r} Q0 ${seg.y} ${r} ${seg.y} H${barW - r} Q${barW} ${seg.y} ${barW} ${seg.y + r} V${seg.y + seg.height} Z`
                      : `M0 ${seg.y} H${barW} V${seg.y + seg.height} H0 Z`;
                    return <path key={seg.key} d={d} fill={color} data-series={seg.key} />;
                  })}
                  {i % labelEvery === 0 && (
                    <text
                      x={barW / 2}
                      y={plotH + 16}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--fg-subtle)"
                    >
                      {c.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Selective direct label: only the tallest column carries its value. */}
            {max > 0 && columns[tallest] && (
              <text
                x={Math.min(
                  width - MARGIN.right,
                  Math.max(MARGIN.left + 14, MARGIN.left + tallest * slot + slot / 2),
                )}
                y={MARGIN.top + plotH - (totalOf(columns[tallest] as Column) / axisMax) * plotH - 4}
                textAnchor="middle"
                fontSize={10}
                fill="var(--fg-muted)"
              >
                {format(totalOf(columns[tallest] as Column))}
              </text>
            )}

            {/* One wide hit target over the whole plot; the column under the pointer is looked up from x. */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onMouseMove={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const i = Math.floor((e.clientX - box.left) / slot);
                setHover(i >= 0 && i < columns.length ? i : null);
              }}
            />
          </svg>

          {hovered && hover !== null && (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 min-w-40 rounded-control border border-border-strong bg-elevated p-2 text-xs shadow-lg"
              style={{
                left: Math.min(
                  width - 170,
                  Math.max(0, MARGIN.left + hover * slot + slot / 2 - 80),
                ),
                top: 4,
              }}
            >
              <p className="mb-1 font-medium">{hovered.title}</p>
              {visible.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-fg-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="tabular-nums text-fg">{format(hovered.values[s.key] ?? 0)}</span>
                </p>
              ))}
              {visible.length > 1 && (
                <p className="mt-1 flex justify-between gap-4 border-t border-border pt-1">
                  <span className="text-fg-muted">Total</span>
                  <span className="tabular-nums">{format(totalOf(hovered))}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {note && <p className="mt-2 text-[11px] text-fg-subtle">{note}</p>}
    </figure>
  );
}
