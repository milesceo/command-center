import { describe, expect, it } from 'vitest';
import { bannerFrame, bannerRows, bannerWidth, fieldFrame, plasma, RAMP } from './ascii-field';

describe('fieldFrame', () => {
  it('has the requested size, uses only ramp characters and is deterministic', () => {
    const frame = fieldFrame(40, 10, 1.5);
    const lines = frame.split('\n');
    expect(lines).toHaveLength(10);
    expect(lines.every((l) => l.length === 40)).toBe(true);
    expect([...frame.replace(/\n/g, '')].every((c) => RAMP.includes(c))).toBe(true);
    expect(fieldFrame(40, 10, 1.5)).toBe(frame);
  });

  it('animates: different times give different frames', () => {
    expect(fieldFrame(40, 10, 0)).not.toBe(fieldFrame(40, 10, 2));
  });

  it('keeps plasma within 0..1', () => {
    for (let i = 0; i < 200; i++) {
      const v = plasma(i * 1.3, i * 0.7, i * 0.1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('banner', () => {
  it('spells the word at the computed width', () => {
    const rows = bannerRows('PROGRAMISH', 1);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.length === bannerWidth('PROGRAMISH', 1))).toBe(true);
    expect(rows.some((r) => r.includes('#'))).toBe(true);
    expect(bannerRows('PROGRAMISH', 2)[0]?.length).toBe(bannerWidth('PROGRAMISH', 2));
  });

  it('lights only the letter pixels', () => {
    const rows = bannerRows('PI', 1);
    const frame = bannerFrame(rows, 0).split('\n');
    frame.forEach((line, y) => {
      [...line].forEach((c, x) => {
        expect(c === ' ').toBe(rows[y]?.[x] !== '#');
      });
    });
  });
});
