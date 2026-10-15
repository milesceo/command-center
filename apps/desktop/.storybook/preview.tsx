import type { Decorator, Preview } from '@storybook/react-vite';
import { useEffect } from 'react';
import { PALETTES } from '../src/lib/appearance';
import { TIER_IDS } from '../src/lib/performance';
import { defaultPrefs } from '../src/lib/prefs';
import { useAppearance } from '../src/lib/use-appearance';
import { usePrefs } from '../src/stores/prefs';
import '../src/styles/index.css';

/**
 * The toolbar globals write into the real prefs store, so components react exactly as they do
 * in the app (theme, palette, accent, density, animation level and performance tier).
 */
/** Applies the saved appearance to <html> (the same hook the app uses). */
function AppearanceBridge() {
  useAppearance();
  return null;
}

const withGeekedAppearance: Decorator = (Story, context) => {
  const { theme, palette, density, motion, tier } = context.globals as Record<string, string>;

  useEffect(() => {
    const base = defaultPrefs();
    usePrefs.setState({
      prefs: {
        ...base,
        onboarding: { completed: true, step: 0 },
        profile: { name: 'Ada' },
        performance: { tier: tier as (typeof TIER_IDS)[number] },
        appearance: {
          ...base.appearance,
          theme: theme as 'dark' | 'light',
          palette: palette as (typeof PALETTES)[number]['id'],
          density: density as 'compact' | 'comfortable',
          motion: motion as 'system' | 'full' | 'reduced' | 'off',
        },
      },
    });
  }, [theme, palette, density, motion, tier]);

  // The shell's tokens hang off <html>, so the story frame needs the app background.
  return (
    <div className="bg-bg p-4 text-fg" style={{ minHeight: '100%' }}>
      <AppearanceBridge />
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withGeekedAppearance],
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: ['dark', 'light'],
        dynamicTitle: true,
      },
    },
    palette: {
      description: 'Color palette',
      toolbar: {
        title: 'Palette',
        icon: 'paintbrush',
        items: PALETTES.map((p) => p.id),
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Density',
      toolbar: {
        title: 'Density',
        icon: 'component',
        items: ['comfortable', 'compact'],
        dynamicTitle: true,
      },
    },
    motion: {
      description: 'Animations',
      toolbar: {
        title: 'Motion',
        icon: 'play',
        items: ['system', 'full', 'reduced', 'off'],
        dynamicTitle: true,
      },
    },
    tier: {
      description: 'Performance tier',
      toolbar: { title: 'Tier', icon: 'lightning', items: [...TIER_IDS], dynamicTitle: true },
    },
  },
  initialGlobals: {
    theme: 'dark',
    palette: 'indigo',
    density: 'comfortable',
    motion: 'system',
    tier: 'balanced',
  },
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    controls: { matchers: { color: /(background|color)$/i } },
    a11y: { test: 'todo' },
  },
};

export default preview;
