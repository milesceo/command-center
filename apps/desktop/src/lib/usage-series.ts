import { EMPTY_TOTALS, type BucketRow, type UsageTotals } from './repo-usage';

/** Local-calendar helpers shared by the SQL bucketing and the zero-filled chart axes. */

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in local time, matching SQLite's `date(..., 'localtime')`. */
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Monday of the week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const sinceMonday = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - sinceMonday);
}

export interface SeriesPoint extends UsageTotals {
  /** Same key the SQL query produces. */
  bucket: string;
  /** Local midnight at the start of the bucket. */
  start: Date;
}

function fill(rows: BucketRow[], starts: Date[]): SeriesPoint[] {
  const byBucket = new Map(rows.map((r) => [r.bucket, r]));
  return starts.map((start) => {
    const bucket = dayKey(start);
    const row = byBucket.get(bucket);
    return { ...(row ?? EMPTY_TOTALS), bucket, start };
  });
}

/** The last `days` days ending today, with zeros for days without usage. */
export function fillDays(rows: BucketRow[], days: number, now = new Date()): SeriesPoint[] {
  const today = startOfDay(now);
  const starts = Array.from(
    { length: days },
    (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i)),
  );
  return fill(rows, starts);
}

/** The last `weeks` weeks (Monday-based) ending with this week. */
export function fillWeeks(rows: BucketRow[], weeks: number, now = new Date()): SeriesPoint[] {
  const thisWeek = startOfWeek(now);
  const starts = Array.from(
    { length: weeks },
    (_, i) =>
      new Date(
        thisWeek.getFullYear(),
        thisWeek.getMonth(),
        thisWeek.getDate() - 7 * (weeks - 1 - i),
      ),
  );
  return fill(rows, starts);
}
