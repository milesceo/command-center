import { useEffect } from 'react';
import { applyAppearance, resolveAppearance } from './apply-appearance';
import { useOsEnvironment } from './use-os-environment';
import { usePrefs } from '../stores/prefs';
import { useUiStore } from '../stores/ui';

/**
 * Applies the saved appearance (theme, palette, accent, animation level, density, glass) to the
 * document and mirrors the resolved theme into the ui store. Mounted by both the splash screen
 * and the app, so the very first frame already uses the user's colors.
 */
export function useAppearance(): void {
  const prefs = usePrefs((s) => s.prefs);
  const os = useOsEnvironment();

  useEffect(() => {
    const applied = resolveAppearance(prefs, os);
    applyAppearance(document.documentElement, prefs, applied);
    // Components that only need dark or light (preview frames, charts) read the resolved theme.
    if (useUiStore.getState().theme !== applied.theme) {
      useUiStore.setState({ theme: applied.theme });
    }
  }, [prefs, os]);
}
