import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import {
  ACCENT_SWATCHES,
  DENSITIES,
  FONT_SCALES,
  PALETTES,
  THEME_CHOICES,
  isHexColor,
  paletteTokens,
  readableOn,
  type Density,
  type ThemeChoice,
} from '../../lib/appearance';
import { resolveAppearance } from '../../lib/apply-appearance';
import { cn } from '../../lib/cn';
import type { MotionSetting } from '../../lib/performance';
import { usePrefs } from '../../stores/prefs';
import { Segmented } from '../ui/segmented';
import { Row } from '../settings/parts';
import { useOsEnvironment } from '../../lib/use-os-environment';
import { platformCopy } from '../../lib/platform-copy';

const THEME_LABELS: Record<ThemeChoice, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'System',
};
const DENSITY_LABELS: Record<Density, string> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
};
const MOTION_OPTIONS: { value: MotionSetting; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'off', label: 'Off' },
];

/**
 * A small mock window drawn from the current preferences. It carries its own palette tokens,
 * so it shows exactly what Theme, Palette, Accent and Density do; the dot pulses only when the
 * resulting animation level allows it. Font size is shown by the sample text size.
 */
export function PreviewCard() {
  const prefs = usePrefs((s) => s.prefs);
  const os = useOsEnvironment();
  const applied = resolveAppearance(prefs, os);
  const tokens = paletteTokens(prefs.appearance.palette, prefs.appearance.accent, applied.theme);
  const compact = applied.density === 'compact';

  const base =
    applied.theme === 'dark'
      ? {
          '--bg': '#0b0b0d',
          '--surface': '#111114',
          '--border': '#232328',
          '--fg': '#ececef',
          '--fg-muted': '#9a9aa6',
          '--accent': '#8b93ff',
          '--accent-fg': '#0b0b0d',
        }
      : {
          '--bg': '#fcfcfd',
          '--surface': '#f5f5f7',
          '--border': '#e4e4ea',
          '--fg': '#16161a',
          '--fg-muted': '#5f5f6b',
          '--accent': '#5b63e6',
          '--accent-fg': '#ffffff',
        };
  const style = { ...base, ...tokens } as React.CSSProperties;

  return (
    <div
      data-testid="preview-card"
      aria-label="Appearance preview"
      role="img"
      style={{
        ...style,
        background: 'var(--bg)',
        color: 'var(--fg)',
        borderColor: 'var(--border)',
      }}
      className="overflow-hidden rounded-panel border"
    >
      <div
        className="flex items-center gap-1.5 border-b px-3 py-1.5"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <span className="size-2 rounded-full" style={{ background: 'var(--accent)' }} />
        <span className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          Command Center
        </span>
        <span
          className={cn(
            'ml-auto size-1.5 rounded-full',
            applied.motion === 'full' && 'animate-pulse',
          )}
          style={{ background: 'var(--accent)' }}
          title={`Animations: ${applied.motion}`}
        />
      </div>
      <div className={cn('flex flex-col px-3', compact ? 'gap-1 py-2' : 'gap-2 py-3')}>
        <p
          className="font-medium"
          style={{ fontSize: `${(13 * prefs.appearance.fontScale) / 100}px` }}
        >
          Good morning{prefs.profile.name ? `, ${prefs.profile.name}` : ''}
        </p>
        {['Refactor the parser', 'Explain this stack trace'].map((row) => (
          <div
            key={row}
            className={cn(
              'flex items-center rounded-control border px-2 text-[11px]',
              compact ? 'h-5' : 'h-7',
            )}
            style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}
          >
            {row}
          </div>
        ))}
        <span
          className="mt-1 inline-flex h-6 w-fit items-center rounded-control px-2 text-[11px] font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          New chat
        </span>
      </div>
    </div>
  );
}

function PaletteGrid() {
  const palette = usePrefs((s) => s.prefs.appearance.palette);
  const setPalette = usePrefs((s) => s.setPalette);
  return (
    <div role="radiogroup" aria-label="Color palette" className="flex flex-wrap gap-2">
      {PALETTES.map((p) => {
        const selected = p.id === palette;
        const dark = paletteTokens(p.id, null, 'dark');
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPalette(p.id)}
            className={cn(
              'flex w-24 flex-col items-stretch gap-1 rounded-control border p-1.5 text-left text-[11px]',
              selected
                ? 'border-accent bg-hover text-fg'
                : 'border-border text-fg-muted hover:bg-hover',
            )}
          >
            <span
              className="flex h-6 overflow-hidden rounded-[4px]"
              style={{ background: dark['--bg'] ?? '#0b0b0d' }}
            >
              <span className="w-1/2" style={{ background: dark['--surface'] ?? '#111114' }} />
              <span
                className="m-1 ml-auto w-3 rounded-[3px]"
                style={{ background: dark['--accent'] ?? p.accentDark }}
              />
            </span>
            <span className="flex items-center justify-between">
              {p.label}
              {selected && <Check size={11} aria-hidden="true" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AccentPicker() {
  const accent = usePrefs((s) => s.prefs.appearance.accent);
  const setAppearance = usePrefs((s) => s.setAppearance);
  // `null` means "show the saved accent"; a string is what the user is typing right now.
  const [typed, setTyped] = useState<string | null>(null);
  const draft = typed ?? accent ?? '';
  const id = useId();

  const commit = (value: string) => {
    const normalized = value.startsWith('#') ? value : `#${value}`;
    if (isHexColor(normalized)) setAppearance({ accent: normalized.toLowerCase() });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Accent color" className="flex gap-1.5">
        {ACCENT_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={`Accent ${hex}`}
            aria-pressed={accent === hex}
            onClick={() => setAppearance({ accent: hex })}
            className={cn(
              'grid size-6 place-items-center rounded-full border',
              accent === hex ? 'border-fg' : 'border-border-strong',
            )}
            style={{ background: hex, color: readableOn(hex) }}
          >
            {accent === hex && <Check size={12} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <label htmlFor={id} className="sr-only">
        Custom accent hex color
      </label>
      <input
        id={id}
        value={draft}
        placeholder="#8b93ff"
        spellCheck={false}
        maxLength={7}
        onChange={(e) => {
          if (isHexColor(e.target.value)) {
            commit(e.target.value);
            setTyped(null);
          } else {
            setTyped(e.target.value);
          }
        }}
        onBlur={() => setTyped(null)}
        className={cn(
          'h-7 w-24 rounded-control border bg-bg px-2 font-mono text-[12px] outline-none focus:border-accent',
          draft !== '' && !isHexColor(draft) ? 'border-danger' : 'border-border',
        )}
      />
      {accent && (
        <button
          type="button"
          onClick={() => setAppearance({ accent: null })}
          className="text-[11px] text-fg-subtle underline-offset-2 hover:text-fg-muted hover:underline"
        >
          Use palette accent
        </button>
      )}
    </div>
  );
}

/** Theme, palette, accent, animations, density and font size, with the live preview card. */
export function AppearanceControls() {
  const a = usePrefs((s) => s.prefs.appearance);
  const set = usePrefs((s) => s.setAppearance);

  return (
    <div className="flex flex-col gap-4" data-testid="appearance-controls">
      <Row label="Theme" hint={`System follows ${platformCopy.os()}.`}>
        <Segmented
          label="Theme"
          value={a.theme}
          options={THEME_CHOICES.map((t) => ({ value: t, label: THEME_LABELS[t] }))}
          onChange={(theme) => set({ theme })}
        />
      </Row>

      <div className="flex flex-col gap-2">
        <p className="text-[13px]">Color palette</p>
        <PaletteGrid />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[13px]">Accent color</p>
        <AccentPicker />
      </div>

      <Row
        label="Animations"
        hint={`System follows your ${platformCopy.os()} reduced-motion setting. The performance tier can lower this further.`}
      >
        <Segmented
          label="Animations"
          value={a.motion}
          options={MOTION_OPTIONS}
          onChange={(motion) => set({ motion })}
        />
      </Row>

      <Row label="Density" hint="Row height in lists.">
        <Segmented
          label="Density"
          value={a.density}
          options={DENSITIES.map((d) => ({ value: d, label: DENSITY_LABELS[d] }))}
          onChange={(density) => set({ density })}
        />
      </Row>

      <Row label="Font size" hint="Scales the whole window.">
        <Segmented
          label="Font size"
          value={a.fontScale}
          options={FONT_SCALES.map((f) => ({ value: f.pct, label: f.label }))}
          onChange={(fontScale) => set({ fontScale })}
        />
      </Row>

      <PreviewCard />
    </div>
  );
}
