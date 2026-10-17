import { describe, expect, it } from 'vitest';
import {
  LEGACY_COPIED_KEY,
  LEGACY_LIBRARY_FORMATS,
  LEGACY_STORAGE_KEYS,
  migrateLegacyStorage,
} from './legacy';
import { buildLibraryFile, parseLibraryFile } from './prompt-library';

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('migrateLegacyStorage', () => {
  it('copies keys from the previous name and keeps the old ones', () => {
    const s = memory({ 'geeked-ui': '{"theme":"light"}', 'geeked-prefs': '{"v":3}' });
    expect(migrateLegacyStorage(s).sort()).toEqual(['command-center-prefs', 'command-center-ui']);
    expect(s.map.get('command-center-ui')).toBe('{"theme":"light"}');
    expect(s.map.get('command-center-prefs')).toBe('{"v":3}');
    expect(s.map.get('geeked-ui')).toBe('{"theme":"light"}');
  });

  it('copies keys from the first name when the profile skipped the second', () => {
    const s = memory({ 'programish-ui': 'old-ui', 'programish-lock': 'record' });
    expect(migrateLegacyStorage(s).sort()).toEqual(['command-center-lock', 'command-center-ui']);
    expect(s.map.get('command-center-lock')).toBe('record');
    expect(s.map.get('programish-lock')).toBe('record');
  });

  it('prefers the newer name when both earlier names are present', () => {
    const s = memory({ 'programish-ui': 'oldest', 'geeked-ui': 'newer' });
    expect(migrateLegacyStorage(s)).toEqual(['command-center-ui']);
    expect(s.map.get('command-center-ui')).toBe('newer');
  });

  it('never overwrites a value the new name already has', () => {
    const s = memory({ 'geeked-ui': 'old', 'programish-ui': 'older', 'command-center-ui': 'new' });
    expect(migrateLegacyStorage(s)).toEqual([]);
    expect(s.map.get('command-center-ui')).toBe('new');
  });

  it('runs once per profile', () => {
    const s = memory({ 'geeked-lock': 'record' });
    expect(migrateLegacyStorage(s)).toEqual(['command-center-lock']);
    expect(s.map.has(LEGACY_COPIED_KEY)).toBe(true);
    expect(migrateLegacyStorage(s)).toEqual([]);
  });

  it('does not bring back a key the app removed after the copy', () => {
    const s = memory({ 'geeked-lock': 'old pin record' });
    migrateLegacyStorage(s);
    s.map.delete('command-center-lock'); // "Remove PIN" / "Forgot PIN" cleared it
    expect(migrateLegacyStorage(s)).toEqual([]);
    expect(s.map.has('command-center-lock')).toBe(false);
  });

  it('does nothing on a fresh profile and survives a throwing storage', () => {
    expect(migrateLegacyStorage(memory())).toEqual([]);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(migrateLegacyStorage(broken)).toEqual([]);
  });

  it('copies an empty old value and treats an empty new value as present', () => {
    const s = memory({ 'geeked-qa': '', 'geeked-ui': 'old', 'command-center-ui': '' });
    expect(migrateLegacyStorage(s)).toEqual(['command-center-qa']);
    expect(s.map.get('command-center-qa')).toBe('');
    expect(s.map.get('command-center-ui')).toBe('');
  });

  it('treats any value of the flag, even an empty one, as already copied', () => {
    const s = memory({ [LEGACY_COPIED_KEY]: '', 'geeked-ui': 'old' });
    expect(migrateLegacyStorage(s)).toEqual([]);
    expect(s.map.has('command-center-ui')).toBe(false);
  });

  it('copies the other keys when one write fails (quota), and does not retry it later', () => {
    const s = memory({ 'geeked-status-feed': 'x'.repeat(10), 'geeked-ui': 'old' });
    const setItem = s.setItem;
    s.setItem = (k: string, v: string) => {
      if (k === 'command-center-status-feed') throw new Error('QuotaExceededError');
      setItem(k, v);
    };
    expect(migrateLegacyStorage(s)).toEqual(['command-center-ui']);
    // Pinned on purpose: the copy is one-shot even after a partial failure (a retry could bring
    // back a removed PIN record). The old key is still there, so nothing is lost for good.
    expect(s.map.has(LEGACY_COPIED_KEY)).toBe(true);
    s.setItem = setItem;
    expect(migrateLegacyStorage(s)).toEqual([]);
    expect(s.map.get('geeked-status-feed')).toBe('xxxxxxxxxx');
  });

  it('does not set the flag when the flag itself cannot be read', () => {
    const s = memory({ 'geeked-ui': 'old' });
    const getItem = s.getItem;
    s.getItem = (k: string) => {
      if (k === LEGACY_COPIED_KEY) throw new Error('blocked');
      return getItem(k);
    };
    expect(migrateLegacyStorage(s)).toEqual([]);
    expect(s.map.has(LEGACY_COPIED_KEY)).toBe(false);
    s.getItem = getItem;
    expect(migrateLegacyStorage(s)).toEqual(['command-center-ui']);
  });

  it('copies the first name for keys only it had, and the newer name for the rest', () => {
    const s = memory({
      'programish-ide': 'first-ide',
      'programish-ui': 'first-ui',
      'geeked-ui': 'second-ui',
      'geeked-prefs': 'second-prefs',
    });
    expect(migrateLegacyStorage(s).sort()).toEqual([
      'command-center-ide',
      'command-center-prefs',
      'command-center-ui',
    ]);
    expect(s.map.get('command-center-ide')).toBe('first-ide');
    expect(s.map.get('command-center-ui')).toBe('second-ui');
  });

  it('never reads a key the first name did not have', () => {
    const s = memory({ 'programish-prefs': 'x', 'programish-qa': 'y' });
    expect(migrateLegacyStorage(s)).toEqual([]);
  });

  it('covers every key the stores persist', () => {
    const targets = [...new Set(LEGACY_STORAGE_KEYS.map(([, n]) => n))].sort();
    expect(targets).toEqual([
      'command-center-ide',
      'command-center-last-message',
      'command-center-lock',
      'command-center-lock-prefs',
      'command-center-lock-web',
      'command-center-prefs',
      'command-center-qa',
      'command-center-settings',
      'command-center-status-feed',
      'command-center-status-known-models',
      'command-center-ui',
    ]);
  });
});

describe('prompt libraries exported before the renames', () => {
  it.each(LEGACY_LIBRARY_FORMATS)('still import (%s)', (format) => {
    const file = JSON.stringify({
      format,
      version: 1,
      prompts: [
        {
          id: 'p1',
          kind: 'prompt',
          title: 'Review',
          tags: [],
          body: 'Review this',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(parseLibraryFile(file)).toHaveLength(1);
  });

  it('still refuses a newer version, a look-alike name or a non-string format', () => {
    const file = (format: unknown, version = 1) => JSON.stringify({ format, version, prompts: [] });
    expect(() => parseLibraryFile(file('geeked-prompts', 2))).toThrow('newer version');
    expect(() => parseLibraryFile(file('programish-prompts', 99))).toThrow('newer version');
    for (const bad of [
      'Geeked-Prompts',
      ' geeked-prompts',
      'geeked-prompt',
      'geeked',
      ['geeked-prompts'],
      null,
    ]) {
      expect(() => parseLibraryFile(file(bad))).toThrow('not a Command Center prompt library');
    }
  });

  it('re-exports an imported old library under the new format name', () => {
    const prompts = parseLibraryFile(
      JSON.stringify({
        format: 'geeked-prompts',
        version: 1,
        prompts: [{ id: 'p1', kind: 'system', title: 'T', tags: ['a'], body: 'b' }],
      }),
    );
    const exported = buildLibraryFile(
      prompts.map((p) => ({ ...p, createdAt: 1, updatedAt: 1 })),
      new Date(0),
    );
    expect(exported.format).toBe('command-center-prompts');
    expect(parseLibraryFile(JSON.stringify(exported))).toHaveLength(1);
  });

  it('accepts both earlier format names', () => {
    expect([...LEGACY_LIBRARY_FORMATS].sort()).toEqual(['geeked-prompts', 'programish-prompts']);
  });
});
