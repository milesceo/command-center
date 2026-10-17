import { describe, expect, it } from 'vitest';
import { SHADE_RAMP, angleAt, buildGeometry, renderSpin } from './ascii3d';

const COLS = 64;
const ROWS = 16;

const inked = (lines: string[]) => lines.join('').replace(/ /g, '').length;
const widthOf = (lines: string[]) => {
  let min = Infinity;
  let max = -1;
  for (const line of lines) {
    const first = line.search(/\S/);
    if (first === -1) continue;
    min = Math.min(min, first);
    max = Math.max(max, line.trimEnd().length - 1);
  }
  return max - min + 1;
};

describe('buildGeometry', () => {
  it('builds a surface-only point cloud with unit-length normals', () => {
    const points = buildGeometry('COMMAND CENTER');
    expect(points.length).toBeGreaterThan(1000);
    for (const p of points.slice(0, 200)) {
      expect(Math.hypot(p.nx, p.ny, p.nz)).toBeCloseTo(1, 5);
    }
  });

  it('is centred on the origin and is thicker in z than a single face', () => {
    const points = buildGeometry('COMMAND CENTER');
    const xs = points.map((p) => p.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 0);
    const zs = points.map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(2);
  });
});

describe('renderSpin', () => {
  it('draws the right grid size using only ramp characters', () => {
    const frame = renderSpin('COMMAND CENTER', 0.4, COLS, ROWS);
    expect(frame).toHaveLength(ROWS);
    for (const line of frame) {
      expect(line).toHaveLength(COLS);
      for (const ch of line) expect(SHADE_RAMP).toContain(ch);
    }
    expect(inked(frame)).toBeGreaterThan(80);
  });

  it('is deterministic', () => {
    expect(renderSpin('COMMAND CENTER', 1.2, COLS, ROWS)).toEqual(
      renderSpin('COMMAND CENTER', 1.2, COLS, ROWS),
    );
  });

  it('looks different at different angles, and is solid-shaded (several ramp levels)', () => {
    const a = renderSpin('COMMAND CENTER', 0, COLS, ROWS).join('\n');
    const b = renderSpin('COMMAND CENTER', 0.9, COLS, ROWS).join('\n');
    expect(a).not.toBe(b);
    const levels = new Set([...b.replace(/\s/g, '')]);
    expect(levels.size).toBeGreaterThanOrEqual(3);
  });

  it('turns edge-on at 90 degrees: much narrower than the front view', () => {
    const front = widthOf(renderSpin('COMMAND CENTER', 0, COLS, ROWS));
    const side = widthOf(renderSpin('COMMAND CENTER', Math.PI / 2, COLS, ROWS));
    expect(front).toBeGreaterThan(COLS * 0.5);
    expect(side).toBeLessThan(front * 0.4);
  });

  it('shows the back as a mirror image after half a turn, with a similar footprint', () => {
    const front = renderSpin('COMMAND CENTER', 0, COLS, ROWS);
    const back = renderSpin('COMMAND CENTER', Math.PI, COLS, ROWS);
    expect(Math.abs(inked(front) - inked(back))).toBeLessThan(inked(front) * 0.15);
  });

  it('keeps the whole word inside the grid at every angle', () => {
    for (let i = 0; i < 24; i++) {
      const frame = renderSpin('COMMAND CENTER', (i / 24) * Math.PI * 2, COLS, ROWS);
      expect(frame.every((line) => line.length === COLS)).toBe(true);
      expect(inked(frame)).toBeGreaterThan(0);
    }
  });
});

describe('angleAt', () => {
  it('advances with time and holds a fixed view when still', () => {
    expect(angleAt(0)).toBe(0);
    expect(angleAt(4.5)).toBeCloseTo(Math.PI, 5);
    expect(angleAt(10, true)).toBe(angleAt(99, true));
  });
});
