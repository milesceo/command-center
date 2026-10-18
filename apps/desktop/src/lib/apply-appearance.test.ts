// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyAppearance, resolveAppearance, resolveTheme } from './apply-appearance';
import { defaultPrefs, type Prefs } from './prefs';

const os = { prefersDark: true, prefersReducedMotion: false };

const withPrefs = (edit: (p: Prefs) => void): Prefs => {
  const p = defaultPrefs();
  edit(p);
  return p;
};

describe('resolveTheme', () => {
  it('follows the OS for "system" and is literal otherwise', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});

describe('resolveAppearance', () => {
  it('combines the tier cap with the animation setting and the OS preference', () => {
    expect(resolveAppearance(defaultPrefs(), os).motion).toBe('full');
    expect(resolveAppearance(defaultPrefs(), { ...os, prefersReducedMotion: true }).motion).toBe(
      'reduced',
    );
    const lightest = withPrefs((p) => {
      p.performance.tier = 'lightest';
    });
    expect(resolveAppearance(lightest, os).motion).toBe('off');
  });

  it('turns glass on only for the tiers that have it', () => {
    const enhanced = withPrefs((p) => {
      p.performance.tier = 'enhanced';
    });
    expect(resolveAppearance(defaultPrefs(), os).glass).toBe(false);
    expect(resolveAppearance(enhanced, os).glass).toBe(true);
  });
});

describe('resolveAppearance with the tier in effect', () => {
  it('defaults to the chosen tier', () => {
    const enhanced = withPrefs((p) => {
      p.performance.tier = 'enhanced';
    });
    expect(resolveAppearance(enhanced, os)).toMatchObject({ tier: 'enhanced', glass: true });
  });

  it("uses the given tier's flags, not the chosen one", () => {
    const accelerated = withPrefs((p) => {
      p.performance.tier = 'accelerated';
    });
    expect(resolveAppearance(accelerated, os, 'light')).toMatchObject({
      tier: 'light',
      glass: false,
      motion: 'reduced',
    });
    expect(resolveAppearance(accelerated, os, 'lightest')).toMatchObject({
      tier: 'lightest',
      glass: false,
      motion: 'off',
    });
  });
});

describe('applyAppearance', () => {
  it('writes the tier in effect to data-tier, not the chosen one', () => {
    const root = document.createElement('html');
    const accelerated = withPrefs((p) => {
      p.performance.tier = 'accelerated';
    });
    applyAppearance(root, accelerated, resolveAppearance(accelerated, os, 'light'));
    expect(root.dataset.tier).toBe('light');
    expect(root.dataset.glass).toBe('false');
    expect(root.dataset.motion).toBe('reduced');
    applyAppearance(root, accelerated, resolveAppearance(accelerated, os));
    expect(root.dataset.tier).toBe('accelerated');
    expect(root.dataset.glass).toBe('true');
  });

  it('writes data attributes and palette tokens, and clears them again', () => {
    const root = document.createElement('html');
    const forest = withPrefs((p) => {
      p.appearance.palette = 'forest';
      p.appearance.density = 'compact';
      p.appearance.theme = 'light';
    });
    applyAppearance(root, forest, resolveAppearance(forest, os));
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.density).toBe('compact');
    expect(root.dataset.tier).toBe('balanced');
    expect(root.style.getPropertyValue('--accent')).toBe('#15803d');
    expect(root.style.getPropertyValue('--bg')).toMatch(/^#[0-9a-f]{6}$/);

    const plain = defaultPrefs();
    applyAppearance(root, plain, resolveAppearance(plain, os));
    expect(root.style.getPropertyValue('--accent')).toBe('');
    expect(root.style.getPropertyValue('--bg')).toBe('');
  });

  it('applies a custom accent', () => {
    const root = document.createElement('html');
    const p = withPrefs((x) => {
      x.appearance.accent = '#ff8800';
    });
    applyAppearance(root, p, resolveAppearance(p, os));
    expect(root.style.getPropertyValue('--accent')).toBe('#ff8800');
  });
});
