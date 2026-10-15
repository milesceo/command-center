import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIER,
  TIER_IDS,
  TIERS,
  effectiveMotion,
  isTierId,
  summarizeTier,
  tierFlags,
} from './performance';

describe('performance tiers', () => {
  it('has five tiers in increasing order with Balanced as the default', () => {
    expect(TIER_IDS).toEqual(['lightest', 'light', 'balanced', 'enhanced', 'accelerated']);
    expect(DEFAULT_TIER).toBe('balanced');
    for (const id of TIER_IDS) expect(TIERS[id].id).toBe(id);
  });

  it('never lowers the ASCII frame rate or drops features as the tier goes up', () => {
    const fps = TIER_IDS.map((id) => tierFlags(id).asciiFps);
    expect([...fps].sort((a, b) => a - b)).toEqual(fps);
    for (const key of ['previewAutoRefresh', 'backgroundIndexing', 'glass'] as const) {
      const values = TIER_IDS.map((id) => tierFlags(id)[key]);
      expect([...values].sort((a, b) => Number(a) - Number(b))).toEqual(values);
    }
  });

  it('maps the extremes to the expected flags', () => {
    expect(tierFlags('lightest')).toMatchObject({
      motion: 'off',
      asciiFps: 0,
      glass: false,
      previewAutoRefresh: false,
    });
    expect(tierFlags('accelerated')).toMatchObject({ motion: 'full', glass: true, asciiFps: 30 });
  });

  it('validates tier ids', () => {
    expect(isTierId('light')).toBe(true);
    expect(isTierId('turbo')).toBe(false);
    expect(isTierId(3)).toBe(false);
  });

  it('describes what a tier turns on and off', () => {
    const lightest = summarizeTier('lightest');
    expect(lightest.off).toContain('Blur and glass effects');
    expect(lightest.off).toContain('ASCII animation (static frame)');
    const accelerated = summarizeTier('accelerated');
    expect(accelerated.on).toContain('ASCII animation at 30 fps');
    expect(accelerated.off).toEqual([]);
  });
});

describe('effectiveMotion', () => {
  it('follows the OS setting when the user chose "system"', () => {
    expect(effectiveMotion('system', 'full', true)).toBe('reduced');
    expect(effectiveMotion('system', 'full', false)).toBe('full');
  });

  it('never exceeds the tier cap', () => {
    expect(effectiveMotion('full', 'reduced', false)).toBe('reduced');
    expect(effectiveMotion('full', 'off', false)).toBe('off');
    expect(effectiveMotion('reduced', 'full', false)).toBe('reduced');
  });

  it('lets the user go lower than the tier', () => {
    expect(effectiveMotion('off', 'full', false)).toBe('off');
  });
});
