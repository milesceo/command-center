import { describe, expect, it } from 'vitest';
import { LEGACY_LIBRARY_FORMAT, LEGACY_STORAGE_KEYS, migrateLegacyStorage } from './legacy';
import { parseLibraryFile } from './prompt-library';

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('migrateLegacyStorage', () => {
  it('copies old keys to the new names and keeps the old ones', () => {
    const s = memory({ 'programish-ui': '{"theme":"light"}', 'programish-lock': 'record' });
    expect(migrateLegacyStorage(s).sort()).toEqual(['geeked-lock', 'geeked-ui']);
    expect(s.map.get('geeked-ui')).toBe('{"theme":"light"}');
    expect(s.map.get('geeked-lock')).toBe('record');
    expect(s.map.get('programish-ui')).toBe('{"theme":"light"}');
  });

  it('never overwrites a value the new name already has', () => {
    const s = memory({ 'programish-ui': 'old', 'geeked-ui': 'new' });
    expect(migrateLegacyStorage(s)).toEqual([]);
    expect(s.map.get('geeked-ui')).toBe('new');
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

  it('covers every key the stores persist', () => {
    expect(LEGACY_STORAGE_KEYS.map(([, n]) => n).sort()).toEqual([
      'geeked-ide',
      'geeked-lock',
      'geeked-lock-prefs',
      'geeked-settings',
      'geeked-ui',
    ]);
  });
});

describe('prompt libraries exported before the rename', () => {
  it('still import', () => {
    const file = JSON.stringify({
      format: LEGACY_LIBRARY_FORMAT,
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
});
