/**
 * The app's one typed settings schema: defaults, validation and versioned migrations.
 *
 * Onboarding writes to it, Settings reads and edits it, and `stores/prefs.ts` persists it.
 * To change the shape: bump `PREFS_VERSION`, append a migration to `MIGRATIONS` (index N
 * upgrades version N to N + 1), and teach `normalizePrefs` the new field. Never edit a shipped
 * migration.
 *
 * Secrets never live here: API keys go to the OS keychain and the PIN hash to the Rust side.
 */

import { DEFAULT_PROVIDER, PROVIDER_IDS, type ProviderId } from '@command-center/protocol';
import {
  DEFAULT_FONT_SCALE,
  DEFAULT_PALETTE,
  DENSITIES,
  FONT_SCALES,
  THEME_CHOICES,
  isHexColor,
  isPaletteId,
  type Density,
  type PaletteId,
  type ThemeChoice,
} from './appearance';
import { DEFAULT_TIER, isTierId, type MotionSetting, type TierId } from './performance';

export const PREFS_VERSION = 3;

/** Minutes of inactivity before locking; 0 turns the idle lock off. */
export const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 30, 60] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number];
export const DEFAULT_AUTO_LOCK: AutoLockMinutes = 15;

/**
 * Minutes without any request before the background bridge process is stopped (it starts again
 * on the next chat or provider check); 0 keeps it running.
 */
export const BRIDGE_IDLE_CHOICES = [0, 5, 10, 30, 60] as const;
export type BridgeIdleMinutes = (typeof BRIDGE_IDLE_CHOICES)[number];
export const DEFAULT_BRIDGE_IDLE: BridgeIdleMinutes = 10;

export const NAME_MIN = 1;
export const NAME_MAX = 32;

export type CloseBehavior = 'tray' | 'quit';
export type ConnectionMethod = 'subscription' | 'apiKey';

export interface ProviderConnection {
  /** The user wants this provider offered in pickers. */
  enabled: boolean;
  /** How the user signs in to it; null until they connect it. */
  method: ConnectionMethod | null;
}

export interface Prefs {
  version: number;
  profile: { name: string };
  onboarding: {
    completed: boolean;
    /** Last step the user reached, so an interrupted flow resumes there. */
    step: number;
  };
  security: { autoLockMinutes: AutoLockMinutes };
  system: {
    autostart: boolean;
    closeBehavior: CloseBehavior;
    bridgeIdleMinutes: BridgeIdleMinutes;
  };
  /** `followPower`: use a lighter tier on battery or in Low Power Mode (macOS). */
  performance: { tier: TierId; followPower: boolean };
  appearance: {
    theme: ThemeChoice;
    palette: PaletteId;
    /** Custom accent as #rrggbb; null uses the palette's own. */
    accent: string | null;
    motion: MotionSetting;
    density: Density;
    /** Whole-interface zoom in percent (see FONT_SCALES). */
    fontScale: number;
  };
  providers: {
    default: ProviderId;
    connections: Record<ProviderId, ProviderConnection>;
  };
  /** Custom models (Model Lab). */
  models: {
    /** Let local models use a server on another computer (off: only this computer). */
    allowRemoteServers: boolean;
  };
}

export function defaultPrefs(): Prefs {
  const connections = Object.fromEntries(
    PROVIDER_IDS.map((id) => [
      id,
      { enabled: id === DEFAULT_PROVIDER, method: id === DEFAULT_PROVIDER ? 'subscription' : null },
    ]),
  ) as Record<ProviderId, ProviderConnection>;
  return {
    version: PREFS_VERSION,
    profile: { name: '' },
    onboarding: { completed: false, step: 0 },
    security: { autoLockMinutes: DEFAULT_AUTO_LOCK },
    system: { autostart: false, closeBehavior: 'quit', bridgeIdleMinutes: DEFAULT_BRIDGE_IDLE },
    performance: { tier: DEFAULT_TIER, followPower: true },
    appearance: {
      theme: 'dark',
      palette: DEFAULT_PALETTE,
      accent: null,
      motion: 'system',
      density: 'comfortable',
      fontScale: DEFAULT_FONT_SCALE,
    },
    providers: { default: DEFAULT_PROVIDER, connections },
    models: { allowRemoteServers: false },
  };
}

// ---------------------------------------------------------------- validation

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** The name step's rule: trimmed, 1 to 32 characters. */
export function checkName(input: string): NameCheck {
  const name = input.trim();
  if (name.length < NAME_MIN) return { ok: false, reason: 'Enter a name.' };
  if ([...name].length > NAME_MAX) {
    return { ok: false, reason: `Use ${NAME_MAX} characters or fewer.` };
  }
  return { ok: true, name };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const oneOf = <T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/**
 * Coerces anything (a parsed JSON blob from any past version) into a valid current `Prefs`.
 * Unknown keys are dropped; invalid values fall back to the default for that field only.
 */
export function normalizePrefs(raw: unknown): Prefs {
  const d = defaultPrefs();
  if (!isObject(raw)) return d;
  const profile = isObject(raw.profile) ? raw.profile : {};
  const onboarding = isObject(raw.onboarding) ? raw.onboarding : {};
  const security = isObject(raw.security) ? raw.security : {};
  const system = isObject(raw.system) ? raw.system : {};
  const performance = isObject(raw.performance) ? raw.performance : {};
  const appearance = isObject(raw.appearance) ? raw.appearance : {};
  const providers = isObject(raw.providers) ? raw.providers : {};
  const models = isObject(raw.models) ? raw.models : {};
  const connections = isObject(providers.connections) ? providers.connections : {};

  const name = typeof profile.name === 'string' ? profile.name.trim() : '';
  const step = onboarding.step;

  const nextConnections = { ...d.providers.connections };
  for (const id of PROVIDER_IDS) {
    const c = connections[id];
    if (!isObject(c)) continue;
    nextConnections[id] = {
      enabled: bool(c.enabled, nextConnections[id].enabled),
      method:
        oneOf<ConnectionMethod | 'none'>(
          c.method ?? 'none',
          ['subscription', 'apiKey', 'none'],
          'none',
        ) === 'none'
          ? null
          : (c.method as ConnectionMethod),
    };
  }

  return {
    version: PREFS_VERSION,
    profile: { name: [...name].slice(0, NAME_MAX).join('') },
    onboarding: {
      completed: bool(onboarding.completed, false),
      step:
        typeof step === 'number' && Number.isInteger(step) && step >= 0 ? Math.min(step, 99) : 0,
    },
    security: {
      autoLockMinutes: oneOf(security.autoLockMinutes, AUTO_LOCK_CHOICES, DEFAULT_AUTO_LOCK),
    },
    system: {
      autostart: bool(system.autostart, false),
      closeBehavior: oneOf<CloseBehavior>(system.closeBehavior, ['tray', 'quit'], 'quit'),
      bridgeIdleMinutes: oneOf(system.bridgeIdleMinutes, BRIDGE_IDLE_CHOICES, DEFAULT_BRIDGE_IDLE),
    },
    performance: {
      tier: isTierId(performance.tier) ? performance.tier : DEFAULT_TIER,
      followPower: bool(performance.followPower, true),
    },
    appearance: {
      theme: oneOf(appearance.theme, THEME_CHOICES, d.appearance.theme),
      palette: isPaletteId(appearance.palette) ? appearance.palette : DEFAULT_PALETTE,
      accent: isHexColor(appearance.accent) ? appearance.accent.toLowerCase() : null,
      motion: oneOf<MotionSetting>(
        appearance.motion,
        ['system', 'full', 'reduced', 'off'],
        d.appearance.motion,
      ),
      density: oneOf(appearance.density, DENSITIES, d.appearance.density),
      fontScale: oneOf(
        appearance.fontScale,
        FONT_SCALES.map((f) => f.pct) as number[],
        DEFAULT_FONT_SCALE,
      ),
    },
    providers: {
      default: oneOf(providers.default, PROVIDER_IDS, DEFAULT_PROVIDER),
      connections: nextConnections,
    },
    models: { allowRemoteServers: bool(models.allowRemoteServers, false) },
  };
}

// --------------------------------------------------------------- migrations

/** Settings that lived in other stores before this schema existed. */
export interface LegacySettings {
  theme?: 'dark' | 'light';
  uiScale?: number;
  autoLockMinutes?: number;
}

export type Migration = (prefs: Json) => Json;

/** `MIGRATIONS[n]` upgrades a version-n document to version n + 1. */
export const MIGRATIONS: readonly Migration[] = [
  // 0 -> 1: the first schema. A document without a version holds nothing (or legacy values
  // injected by `migratePrefs`), which `normalizePrefs` then validates.
  (prefs) => prefs,
  // 1 -> 2: the bridge stops after idle minutes, and the tier follows battery and Low Power Mode
  // (Phase B); existing users get both defaults.
  (prefs) => {
    const system = isObject(prefs.system) ? prefs.system : {};
    const performance = isObject(prefs.performance) ? prefs.performance : {};
    return {
      ...prefs,
      system: { ...system, bridgeIdleMinutes: DEFAULT_BRIDGE_IDLE },
      performance: { ...performance, followPower: true },
    };
  },
  // 2 -> 3: custom models (Phase C); remote model servers stay off until the user allows them.
  (prefs) => ({ ...prefs, models: { allowRemoteServers: false } }),
];

/** Applies every migration from the document's version up to `target`. Exported for tests. */
export function runMigrations(
  doc: Json,
  migrations: readonly Migration[] = MIGRATIONS,
  target = migrations.length,
): Json {
  let version = typeof doc.version === 'number' && Number.isInteger(doc.version) ? doc.version : 0;
  let current = doc;
  while (version < target) {
    const step = migrations[version];
    if (!step) break;
    current = { ...step(current), version: version + 1 };
    version += 1;
  }
  return current;
}

/**
 * Loads stored preferences of any age. `stored` is the parsed JSON (or null when nothing is
 * saved yet); `legacy` carries values from the stores that predate this schema and is only
 * used when nothing is saved.
 */
export function migratePrefs(stored: unknown, legacy: LegacySettings = {}): Prefs {
  if (isObject(stored)) {
    // A document from a newer build is kept as far as it validates rather than discarded.
    return normalizePrefs(runMigrations(stored));
  }
  const fromLegacy: Json = {
    appearance: {
      ...(legacy.theme ? { theme: legacy.theme } : {}),
      ...(legacy.uiScale ? { fontScale: legacy.uiScale } : {}),
    },
    security:
      legacy.autoLockMinutes === undefined ? {} : { autoLockMinutes: legacy.autoLockMinutes },
  };
  return normalizePrefs(runMigrations(fromLegacy));
}
