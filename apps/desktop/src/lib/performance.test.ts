import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIER,
  TIER_IDS,
  TIERS,
  effectiveMotion,
  effectiveTier,
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

describe('effectiveTier', () => {
  const rank = (id: (typeof TIER_IDS)[number]) => TIER_IDS.indexOf(id);
  const AC = { onBattery: false, lowPower: false };
  const BATTERY = { onBattery: true, lowPower: false };
  const LOW_POWER_AC = { onBattery: false, lowPower: true };
  const LOW_POWER_BATTERY = { onBattery: true, lowPower: true };

  it('returns the chosen tier when power is unknown or the user does not follow it', () => {
    for (const id of TIER_IDS) {
      expect(effectiveTier(id, null, true)).toBe(id);
      expect(effectiveTier(id, null, false)).toBe(id);
      for (const power of [AC, BATTERY, LOW_POWER_AC, LOW_POWER_BATTERY]) {
        expect(effectiveTier(id, power, false)).toBe(id);
      }
    }
  });

  it('leaves every tier alone on mains power', () => {
    for (const id of TIER_IDS) expect(effectiveTier(id, AC, true)).toBe(id);
  });

  it('caps at Light on battery and at Lightest in Low Power Mode, for every tier', () => {
    const expected: Record<(typeof TIER_IDS)[number], [string, string]> = {
      lightest: ['lightest', 'lightest'],
      light: ['light', 'lightest'],
      balanced: ['light', 'lightest'],
      enhanced: ['light', 'lightest'],
      accelerated: ['light', 'lightest'],
    };
    for (const id of TIER_IDS) {
      const [battery, lowPower] = expected[id];
      expect(effectiveTier(id, BATTERY, true), `${id} on battery`).toBe(battery);
      expect(effectiveTier(id, LOW_POWER_AC, true), `${id} low power on AC`).toBe(lowPower);
      expect(effectiveTier(id, LOW_POWER_BATTERY, true), `${id} low power on battery`).toBe(
        lowPower,
      );
    }
  });

  it('never raises the chosen tier', () => {
    for (const id of TIER_IDS) {
      for (const power of [null, AC, BATTERY, LOW_POWER_AC, LOW_POWER_BATTERY]) {
        for (const follow of [true, false]) {
          expect(rank(effectiveTier(id, power, follow))).toBeLessThanOrEqual(rank(id));
        }
      }
    }
  });
});
