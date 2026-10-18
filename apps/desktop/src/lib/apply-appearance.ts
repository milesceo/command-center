import {
  PALETTE_TOKEN_NAMES,
  paletteTokens,
  type Density,
  type ResolvedTheme,
  type ThemeChoice,
} from './appearance';
import { effectiveMotion, tierFlags, type MotionCap, type TierId } from './performance';
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
  /** The tier in effect (the chosen one, possibly capped for battery; see `effectiveTier`). */
  tier: TierId;
}

export const resolveTheme = (choice: ThemeChoice, prefersDark: boolean): ResolvedTheme =>
  choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;

/**
 * What the preferences resolve to right now, given the operating system's settings and the tier
 * in effect (defaults to the chosen one).
 */
export function resolveAppearance(
  prefs: Prefs,
  os: OsEnvironment,
  tier: TierId = prefs.performance.tier,
): AppliedAppearance {
  const flags = tierFlags(tier);
  return {
    theme: resolveTheme(prefs.appearance.theme, os.prefersDark),
    motion: effectiveMotion(prefs.appearance.motion, flags.motion, os.prefersReducedMotion),
    density: prefs.appearance.density,
    glass: flags.glass,
    tier,
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
  root.dataset.tier = applied.tier;

  for (const name of PALETTE_TOKEN_NAMES) root.style.removeProperty(name);
  const tokens = paletteTokens(prefs.appearance.palette, prefs.appearance.accent, applied.theme);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
}
