import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  NAME_MAX,
  PREFS_VERSION,
  checkName,
  defaultPrefs,
  migratePrefs,
  normalizePrefs,
  runMigrations,
} from './prefs';

describe('defaults', () => {
  it('are valid and stable under normalization', () => {
    const d = defaultPrefs();
    expect(normalizePrefs(d)).toEqual(d);
    expect(d.performance.tier).toBe('balanced');
    expect(d.appearance.motion).toBe('system');
    expect(d.system).toEqual({ autostart: false, closeBehavior: 'quit', bridgeIdleMinutes: 10 });
    expect(d.providers.default).toBe('claude');
    expect(d.onboarding.completed).toBe(false);
  });
});

describe('checkName', () => {
  it('trims and requires 1 to 32 characters', () => {
    expect(checkName('  Elijah  ')).toEqual({ ok: true, name: 'Elijah' });
    expect(checkName('   ').ok).toBe(false);
    expect(checkName('').ok).toBe(false);
    expect(checkName('a'.repeat(NAME_MAX)).ok).toBe(true);
    expect(checkName('a'.repeat(NAME_MAX + 1)).ok).toBe(false);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(checkName('😀'.repeat(NAME_MAX)).ok).toBe(true);
    expect(checkName('😀'.repeat(NAME_MAX + 1)).ok).toBe(false);
  });
});

describe('normalizePrefs', () => {
  it('repairs invalid fields one at a time and keeps the valid ones', () => {
    const out = normalizePrefs({
      profile: { name: '  Ada  ' },
      performance: { tier: 'warp' },
      appearance: { theme: 'light', palette: 'nope', accent: 'blue', density: 'compact' },
      security: { autoLockMinutes: 7 },
      system: { closeBehavior: 'tray', autostart: 'yes' },
    });
    expect(out.profile.name).toBe('Ada');
    expect(out.performance.tier).toBe('balanced');
    expect(out.appearance).toMatchObject({
      theme: 'light',
      palette: 'indigo',
      accent: null,
      density: 'compact',
    });
    expect(out.security.autoLockMinutes).toBe(15);
    expect(out.system).toEqual({ autostart: false, closeBehavior: 'tray', bridgeIdleMinutes: 10 });
  });

  it('drops unknown keys and survives garbage', () => {
    expect(normalizePrefs('nonsense')).toEqual(defaultPrefs());
    expect(normalizePrefs(null)).toEqual(defaultPrefs());
    expect(normalizePrefs([1, 2])).toEqual(defaultPrefs());
    const out = normalizePrefs({ extra: 1, profile: { name: 'x', secret: 'y' } });
    expect(out).not.toHaveProperty('extra');
    expect(out.profile).toEqual({ name: 'x' });
  });

  it('keeps provider connections and rejects unknown methods', () => {
    const out = normalizePrefs({
      providers: {
        default: 'openai',
        connections: {
          openai: { enabled: true, method: 'subscription' },
          xai: { enabled: true, method: 'password' },
        },
      },
    });
    expect(out.providers.default).toBe('openai');
    expect(out.providers.connections.openai).toEqual({ enabled: true, method: 'subscription' });
    expect(out.providers.connections.xai.method).toBeNull();
  });

  it('lowercases a valid accent and clamps the saved onboarding step', () => {
    const out = normalizePrefs({
      appearance: { accent: '#AABBCC' },
      onboarding: { step: 3.5 },
    });
    expect(out.appearance.accent).toBe('#aabbcc');
    expect(out.onboarding.step).toBe(0);
  });
});

describe('migrations', () => {
  it('stamps the current version on a stored document', () => {
    const out = migratePrefs({ profile: { name: 'Ada' } });
    expect(out.version).toBe(PREFS_VERSION);
    expect(out.profile.name).toBe('Ada');
  });

  it('imports values from the pre-schema stores when nothing is saved', () => {
    const out = migratePrefs(null, { theme: 'light', uiScale: 110, autoLockMinutes: 30 });
    expect(out.appearance.theme).toBe('light');
    expect(out.appearance.fontScale).toBe(110);
    expect(out.security.autoLockMinutes).toBe(30);
    expect(out.onboarding.completed).toBe(false);
  });

  it('ignores legacy values once a document exists', () => {
    const out = migratePrefs({ appearance: { theme: 'dark' } }, { theme: 'light' });
    expect(out.appearance.theme).toBe('dark');
  });

  it('runs every step from the stored version to the target, in order', () => {
    const steps = [
      (p: Record<string, unknown>) => ({ ...p, trail: [...((p.trail as string[]) ?? []), 'a'] }),
      (p: Record<string, unknown>) => ({ ...p, trail: [...((p.trail as string[]) ?? []), 'b'] }),
      (p: Record<string, unknown>) => ({ ...p, trail: [...((p.trail as string[]) ?? []), 'c'] }),
    ];
    expect(runMigrations({}, steps)).toMatchObject({ version: 3, trail: ['a', 'b', 'c'] });
    expect(runMigrations({ version: 1 }, steps)).toMatchObject({ version: 3, trail: ['b', 'c'] });
    expect(runMigrations({ version: 3 }, steps)).toMatchObject({ version: 3 });
  });

  it('does not downgrade a document from a newer build', () => {
    const out = runMigrations({ version: 99 }, MIGRATIONS);
    expect(out.version).toBe(99);
    expect(migratePrefs({ version: 99, profile: { name: 'Zed' } }).profile.name).toBe('Zed');
  });

  it('has one migration per schema version', () => {
    expect(MIGRATIONS).toHaveLength(PREFS_VERSION);
  });
});

describe('bridge idle setting (version 2)', () => {
  it('defaults to 10 minutes and repairs invalid values', () => {
    expect(defaultPrefs().system.bridgeIdleMinutes).toBe(10);
    expect(normalizePrefs({ system: { bridgeIdleMinutes: 7 } }).system.bridgeIdleMinutes).toBe(10);
    expect(normalizePrefs({ system: { bridgeIdleMinutes: 0 } }).system.bridgeIdleMinutes).toBe(0);
    expect(normalizePrefs({ system: { bridgeIdleMinutes: 60 } }).system.bridgeIdleMinutes).toBe(60);
  });

  it('migrates a version-1 document, keeping its other system choices', () => {
    const out = runMigrations({ version: 1, system: { autostart: true, closeBehavior: 'tray' } });
    expect(out).toMatchObject({
      version: 3,
      system: { autostart: true, closeBehavior: 'tray', bridgeIdleMinutes: 10 },
      models: { allowRemoteServers: false },
    });
  });
});
