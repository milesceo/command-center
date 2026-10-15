import {
  PALETTE_TOKEN_NAMES,
  paletteTokens,
  type Density,
  type ResolvedTheme,
  type ThemeChoice,
} from './appearance';
import { effectiveMotion, tierFlags, type MotionCap } from './performance';
import type { Prefs } from './prefs';

export interface OsEnvironment {
  prefersDark: boolean;
  prefersReducedMotion: boolean;
}

export interface AppliedAppearance {
  theme: ResolvedTheme;
  motion: MotionCap;
  density: Density;
  glass: boolean;
}

export const resolveTheme = (choice: ThemeChoice, prefersDark: boolean): ResolvedTheme =>
  choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;

/** What the preferences resolve to right now, given the operating system's settings. */
export function resolveAppearance(prefs: Prefs, os: OsEnvironment): AppliedAppearance {
  const flags = tierFlags(prefs.performance.tier);
  return {
    theme: resolveTheme(prefs.appearance.theme, os.prefersDark),
    motion: effectiveMotion(prefs.appearance.motion, flags.motion, os.prefersReducedMotion),
    density: prefs.appearance.density,
    glass: flags.glass,
  };
}

/**
 * Writes the resolved appearance onto <html>: the theme attribute the CSS tokens key off,
 * palette/accent token overrides, and `data-*` switches for motion, density and glass.
 * Zoom is applied separately (`applyDisplaySettings`) because it also needs the code font size.
 */
export function applyAppearance(root: HTMLElement, prefs: Prefs, applied: AppliedAppearance): void {
  root.dataset.theme = applied.theme;
  root.dataset.motion = applied.motion;
  root.dataset.density = applied.density;
  root.dataset.glass = String(applied.glass);
  root.dataset.tier = prefs.performance.tier;

  for (const name of PALETTE_TOKEN_NAMES) root.style.removeProperty(name);
  const tokens = paletteTokens(prefs.appearance.palette, prefs.appearance.accent, applied.theme);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
}
