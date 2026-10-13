export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** Shown at the bar tip. */
  display: string;
  /** Tooltip with the full breakdown. */
  title?: string;
  dim?: boolean;
}

/**
 * Horizontal ranking of one measure: every bar the same color (the categories are
 * nominal, so a ramp would only double-encode length), the value at the tip, and the
 * name in text color beside it.
 */
export function BarList({ items, label }: { items: BarItem[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-xs"
          title={item.title}
        >
          <span className={item.dim ? 'truncate text-fg-subtle italic' : 'truncate text-fg-muted'}>
            {item.label}
          </span>
          <span className="h-4 rounded-sm" aria-hidden="true">
            <span
              className="block h-full rounded-r-[4px]"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                background: 'var(--series-1)',
              }}
            />
          </span>
          <span className="min-w-14 text-right tabular-nums">{item.display}</span>
        </li>
      ))}
    </ul>
  );
}
