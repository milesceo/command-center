import { create } from 'zustand';
import type { ProviderId } from '@command-center/protocol';
import type { Density, PaletteId, ThemeChoice } from '../lib/appearance';
import type { TierId, MotionSetting } from '../lib/performance';
import {
  checkName,
  defaultPrefs,
  migratePrefs,
  type AutoLockMinutes,
  type BridgeIdleMinutes,
  type CloseBehavior,
  type ConnectionMethod,
  type LegacySettings,
  type Prefs,
} from '../lib/prefs';

const KEY = 'command-center-prefs';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Values from the stores that existed before the prefs schema (read once, never written). */
function readLegacy(): LegacySettings {
  const ui = readJson('command-center-ui') as { state?: { theme?: unknown } } | null;
  const settings = readJson('command-center-settings') as { state?: { uiScale?: unknown } } | null;
  const lock = readJson('command-center-lock-prefs') as { autoLockMinutes?: unknown } | null;
  const legacy: LegacySettings = {};
  const theme = ui?.state?.theme;
  if (theme === 'dark' || theme === 'light') legacy.theme = theme;
  const scale = settings?.state?.uiScale;
  if (typeof scale === 'number') legacy.uiScale = scale;
  const minutes = lock?.autoLockMinutes;
  if (typeof minutes === 'number') legacy.autoLockMinutes = minutes;
  return legacy;
}

export function loadPrefs(): Prefs {
  return migratePrefs(readJson(KEY), readLegacy());
}

function save(prefs: Prefs): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Without storage the app still works for this session.
  }
}

interface PrefsState {
  prefs: Prefs;

  setName: (name: string) => boolean;
  setAutoLock: (minutes: AutoLockMinutes) => void;
  setAutostart: (enabled: boolean) => void;
  setCloseBehavior: (behavior: CloseBehavior) => void;
  setBridgeIdle: (minutes: BridgeIdleMinutes) => void;
  setAllowRemoteServers: (allow: boolean) => void;
  setTier: (tier: TierId) => void;
  setFollowPower: (follow: boolean) => void;
  setAppearance: (patch: Partial<Prefs['appearance']>) => void;
  setTheme: (theme: ThemeChoice) => void;
  setPalette: (palette: PaletteId) => void;
  setMotion: (motion: MotionSetting) => void;
  setDensity: (density: Density) => void;
  setDefaultProvider: (id: ProviderId) => void;
  setConnection: (
    id: ProviderId,
    patch: { enabled?: boolean; method?: ConnectionMethod | null },
  ) => void;
  setOnboardingStep: (step: number) => void;
  completeOnboarding: () => void;
  /** "Re-run onboarding": shows the flow again, keeping every current value as its starting point. */
  restartOnboarding: () => void;
  /** Back to defaults (used by "Forgot PIN" wipes). */
  reset: () => void;
}

export const usePrefs = create<PrefsState>()((set, get) => {
  const commit = (next: Prefs) => {
    save(next);
    set({ prefs: next });
  };
  const patch = (fn: (p: Prefs) => Prefs) => commit(fn(get().prefs));

  return {
    prefs: loadPrefs(),

    setName: (name) => {
      const checked = checkName(name);
      if (!checked.ok) return false;
      patch((p) => ({ ...p, profile: { name: checked.name } }));
      return true;
    },
    setAutoLock: (autoLockMinutes) => patch((p) => ({ ...p, security: { autoLockMinutes } })),
    setAutostart: (autostart) => patch((p) => ({ ...p, system: { ...p.system, autostart } })),
    setCloseBehavior: (closeBehavior) =>
      patch((p) => ({ ...p, system: { ...p.system, closeBehavior } })),
    setBridgeIdle: (bridgeIdleMinutes) =>
      patch((p) => ({ ...p, system: { ...p.system, bridgeIdleMinutes } })),
    setAllowRemoteServers: (allowRemoteServers) =>
      patch((p) => ({ ...p, models: { allowRemoteServers } })),
    setTier: (tier) => patch((p) => ({ ...p, performance: { ...p.performance, tier } })),
    setFollowPower: (followPower) =>
      patch((p) => ({ ...p, performance: { ...p.performance, followPower } })),
    setAppearance: (partial) =>
      patch((p) => ({ ...p, appearance: { ...p.appearance, ...partial } })),
    setTheme: (theme) => get().setAppearance({ theme }),
    setPalette: (palette) => get().setAppearance({ palette }),
    setMotion: (motion) => get().setAppearance({ motion }),
    setDensity: (density) => get().setAppearance({ density }),
    setDefaultProvider: (id) =>
      patch((p) => ({ ...p, providers: { ...p.providers, default: id } })),
    setConnection: (id, partial) =>
      patch((p) => ({
        ...p,
        providers: {
          ...p.providers,
          connections: {
            ...p.providers.connections,
            [id]: { ...p.providers.connections[id], ...partial },
          },
        },
      })),
    setOnboardingStep: (step) =>
      patch((p) => ({ ...p, onboarding: { ...p.onboarding, step: Math.max(0, step) } })),
    completeOnboarding: () => patch((p) => ({ ...p, onboarding: { completed: true, step: 0 } })),
    restartOnboarding: () => patch((p) => ({ ...p, onboarding: { completed: false, step: 0 } })),
    reset: () => commit(defaultPrefs()),
  };
});

export const prefsStore = usePrefs;
