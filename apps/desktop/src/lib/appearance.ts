/**
 * Appearance choices and the CSS tokens they produce. Pure functions: `stores/prefs.ts` holds
 * the state and `applyAppearance` (stores/appearance.ts) writes the result onto <html>.
 *
 * Palettes only retint the neutral surfaces (same lightness steps as the built-in tokens, so
 * the contrast the a11y audit checks is unchanged) and pick a default accent.
 */

export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
export type Density = 'compact' | 'comfortable';
export type PaletteId = 'indigo' | 'graphite' | 'midnight' | 'forest' | 'plum' | 'ember';

export const THEME_CHOICES: readonly ThemeChoice[] = ['dark', 'light', 'system'];
export const DENSITIES: readonly Density[] = ['compact', 'comfortable'];

/** Whole-interface zoom steps; these match `UI_SCALES` in stores/settings.ts. */
export const FONT_SCALES = [
  { pct: 90, label: 'Small' },
  { pct: 100, label: 'Default' },
  { pct: 110, label: 'Large' },
  { pct: 125, label: 'Extra large' },
] as const;
export const DEFAULT_FONT_SCALE = 100;

export interface Palette {
  id: PaletteId;
  label: string;
  /** Hue (0-360) and saturation (0-100) of the tinted neutrals; null keeps the built-in tokens. */
  tint: { hue: number; saturation: number } | null;
  accentDark: string;
  accentLight: string;
}

export const PALETTES: readonly Palette[] = [
  { id: 'indigo', label: 'Indigo', tint: null, accentDark: '#8b93ff', accentLight: '#5b63e6' },
  {
    id: 'graphite',
    label: 'Graphite',
    tint: { hue: 220, saturation: 4 },
    accentDark: '#c4c4cc',
    accentLight: '#3f3f46',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    tint: { hue: 215, saturation: 22 },
    accentDark: '#5eb0ff',
    accentLight: '#1d6fd1',
  },
  {
    id: 'forest',
    label: 'Forest',
    tint: { hue: 150, saturation: 14 },
    accentDark: '#4ade80',
    accentLight: '#15803d',
  },
  {
    id: 'plum',
    label: 'Plum',
    tint: { hue: 285, saturation: 16 },
    accentDark: '#d08cff',
    accentLight: '#8e2bd1',
  },
  {
    id: 'ember',
    label: 'Ember',
    tint: { hue: 25, saturation: 14 },
    accentDark: '#fb923c',
    accentLight: '#c2410c',
  },
];

export const DEFAULT_PALETTE: PaletteId = 'indigo';

/** Quick accent swatches next to the custom hex field. */
export const ACCENT_SWATCHES = [
  '#8b93ff',
  '#5eb0ff',
  '#22d3ee',
  '#4ade80',
  '#facc15',
  '#fb923c',
  '#f472b6',
  '#d08cff',
] as const;

export const isPaletteId = (value: unknown): value is PaletteId =>
  PALETTES.some((p) => p.id === value);

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

/** Lightness (%) of each neutral surface, matching the built-in tokens. */
const LIGHTNESS = {
  dark: { bg: 4.5, surface: 7, elevated: 9.5, hover: 12, border: 14.5, 'border-strong': 20 },
  light: { bg: 99, surface: 96, elevated: 100, hover: 93, border: 90, 'border-strong': 84 },
} as const;

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** WCAG relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Black or white text, whichever reads better on `background`. */
export function readableOn(background: string): string {
  return luminance(background) > 0.35 ? '#0b0b0d' : '#ffffff';
}

/**
 * The CSS custom properties for a palette and accent in the given theme. An empty object means
 * "use the stylesheet's built-in tokens" (the default palette with no custom accent).
 */
export function paletteTokens(
  paletteId: PaletteId,
  accent: string | null,
  theme: ResolvedTheme,
): Record<string, string> {
  const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0]!;
  const tokens: Record<string, string> = {};
  if (palette.tint) {
    for (const [name, lightness] of Object.entries(LIGHTNESS[theme])) {
      tokens[`--${name}`] = hslToHex(palette.tint.hue, palette.tint.saturation, lightness);
    }
  }
  const customAccent = isHexColor(accent) ? accent : null;
  const wantsAccent =
    customAccent ?? (paletteId === DEFAULT_PALETTE ? null : accentFor(palette, theme));
  if (wantsAccent) {
    tokens['--accent'] = wantsAccent;
    tokens['--accent-fg'] = readableOn(wantsAccent);
  }
  return tokens;
}

const accentFor = (palette: Palette, theme: ResolvedTheme) =>
  theme === 'dark' ? palette.accentDark : palette.accentLight;

/** Every token name `paletteTokens` can set, so the applier can clear stale ones. */
export const PALETTE_TOKEN_NAMES = [
  '--bg',
  '--surface',
  '--elevated',
  '--hover',
  '--border',
  '--border-strong',
  '--accent',
  '--accent-fg',
] as const;
