import { describe, expect, it } from 'vitest';
import { niceTicks, stackSegments } from './chart-math';

describe('niceTicks', () => {
  it('rounds to clean steps and always covers the max', () => {
    expect(niceTicks(173)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(1000)).toEqual([0, 500, 1000]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0.8)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(12_345_678).at(-1)).toBeGreaterThanOrEqual(12_345_678);
  });
  it('has a sane axis for empty data', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });
});

describe('stackSegments', () => {
  it('stacks from the baseline with a gap between fills', () => {
    const [a, b] = stackSegments(
      [
        { key: 'a', value: 50 },
        { key: 'b', value: 25 },
      ],
      100,
      200,
    );
    expect(a).toEqual({ key: 'a', value: 50, y: 100, height: 100 });
    expect(b).toEqual({ key: 'b', value: 25, y: 50, height: 48 }); // 50 px of data minus the 2 px gap
  });
  it('skips empty series and keeps tiny values visible', () => {
    const segments = stackSegments(
      [
        { key: 'a', value: 0 },
        { key: 'b', value: 0.001 },
      ],
      100,
      200,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.height).toBe(1);
  });
  it('is empty when nothing is plotted', () => {
    expect(stackSegments([{ key: 'a', value: 5 }], 0, 200)).toEqual([]);
  });
});
