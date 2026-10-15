import { describe, expect, it } from 'vitest';
import {
  FONT_SCALES,
  PALETTES,
  isHexColor,
  isPaletteId,
  luminance,
  paletteTokens,
  readableOn,
} from './appearance';

describe('paletteTokens', () => {
  it('leaves the built-in tokens alone for the default palette with no custom accent', () => {
    expect(paletteTokens('indigo', null, 'dark')).toEqual({});
    expect(paletteTokens('indigo', null, 'light')).toEqual({});
  });

  it('retints neutrals and picks the palette accent per theme', () => {
    const dark = paletteTokens('forest', null, 'dark');
    const light = paletteTokens('forest', null, 'light');
    expect(dark['--accent']).toBe('#4ade80');
    expect(light['--accent']).toBe('#15803d');
    expect(dark['--bg']).toMatch(/^#[0-9a-f]{6}$/);
    expect(luminance(dark['--bg']!)).toBeLessThan(0.02);
    expect(luminance(light['--bg']!)).toBeGreaterThan(0.9);
  });

  it('keeps surfaces ordered by lightness in the dark theme', () => {
    const t = paletteTokens('midnight', null, 'dark');
    const order = ['--bg', '--surface', '--elevated', '--hover', '--border', '--border-strong'];
    const lum = order.map((k) => luminance(t[k]!));
    expect([...lum].sort((a, b) => a - b)).toEqual(lum);
  });

  it('applies a custom accent on any palette and picks readable text for it', () => {
    const t = paletteTokens('indigo', '#facc15', 'dark');
    expect(t['--accent']).toBe('#facc15');
    expect(t['--accent-fg']).toBe('#0b0b0d');
    expect(paletteTokens('plum', '#1d6fd1', 'dark')['--accent-fg']).toBe('#ffffff');
  });

  it('ignores an invalid accent', () => {
    expect(paletteTokens('indigo', 'red', 'dark')).toEqual({});
  });
});

describe('appearance helpers', () => {
  it('offers between 4 and 6 palettes and validates ids', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(4);
    expect(PALETTES.length).toBeLessThanOrEqual(6);
    expect(isPaletteId('ember')).toBe(true);
    expect(isPaletteId('neon')).toBe(false);
  });

  it('validates hex colors', () => {
    expect(isHexColor('#a1B2c3')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor(12)).toBe(false);
  });

  it('computes readable foregrounds', () => {
    expect(readableOn('#000000')).toBe('#ffffff');
    expect(readableOn('#ffffff')).toBe('#0b0b0d');
  });

  it('keeps font scales ascending with a 100% default', () => {
    const pct: number[] = FONT_SCALES.map((f) => f.pct);
    expect(pct).toEqual([...pct].sort((a, b) => a - b));
    expect(pct).toContain(100);
  });
});
