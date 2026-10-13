/** Round axis ticks from 0 up to at least `max` (about `target` intervals): 0, 50, 100, 150, 200. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) {
    ticks.push(Number(v.toPrecision(12)));
    if (v >= max) break;
  }
  return ticks;
}

export interface Segment {
  key: string;
  value: number;
  /** Top edge and height in px, measured from the top of the plot area. */
  y: number;
  height: number;
}

/**
 * Stacked segments for one column. Each segment after the first loses `gap` px of
 * height so neighbouring fills are separated by surface-coloured air rather than a
 * border. Zero-valued series take no space; a segment never shrinks below 1 px.
 */
export function stackSegments(
  values: { key: string; value: number }[],
  axisMax: number,
  plotHeight: number,
  gap = 2,
): Segment[] {
  const out: Segment[] = [];
  let bottom = plotHeight;
  for (const { key, value } of values) {
    if (!(value > 0) || !(axisMax > 0)) continue;
    const full = (value / axisMax) * plotHeight;
    const height = Math.max(1, out.length === 0 ? full : full - gap);
    // The gap sits between this fill and the one below it, so the stack's top still reaches the data value.
    out.push({ key, value, y: out.length === 0 ? bottom - height : bottom - full, height });
    bottom -= full;
  }
  return out;
}
