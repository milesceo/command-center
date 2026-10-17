import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIXED_SHORTCUTS,
  SHORTCUTS,
  formatKeys,
  isMacPlatform,
  keysFor,
  matchShortcut,
  shortcutKeys,
  shortcutLabel,
  type KeyEventLike,
} from './shortcuts';

const ev = (key: string, over: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe('matchShortcut', () => {
  it('matches Ctrl on Windows/Linux and Cmd on macOS', () => {
    expect(matchShortcut(ev('C', { ctrlKey: true, shiftKey: true }), false)).toBe('copyLastCode');
    expect(matchShortcut(ev('c', { metaKey: true, shiftKey: true }), true)).toBe('copyLastCode');
    expect(matchShortcut(ev('C', { ctrlKey: true, shiftKey: true }), true)).toBeNull();
  });

  it('maps each action to its own keys', () => {
    expect(matchShortcut(ev('P', { ctrlKey: true, shiftKey: true }), false)).toBe('togglePreview');
    expect(matchShortcut(ev('D', { ctrlKey: true, shiftKey: true }), false)).toBe('toggleDiffMode');
    expect(matchShortcut(ev('b', { ctrlKey: true }), false)).toBe('toggleSidebar');
    expect(matchShortcut(ev('/', { ctrlKey: true }), false)).toBe('showShortcuts');
  });

  it('is exact about modifiers so ordinary typing and other combos are untouched', () => {
    expect(matchShortcut(ev('c', { ctrlKey: true }), false)).toBeNull(); // plain copy
    expect(matchShortcut(ev('b', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(matchShortcut(ev('b', { ctrlKey: true, altKey: true }), false)).toBeNull(); // AltGr on some layouts
    expect(matchShortcut(ev('b'), false)).toBeNull();
  });

  it('has no duplicate key combinations', () => {
    expect(new Set(SHORTCUTS.map((s) => s.keys)).size).toBe(SHORTCUTS.length);
  });
});

describe('formatKeys', () => {
  it('uses platform symbols', () => {
    expect(formatKeys('Mod+Shift+C', false)).toEqual(['Ctrl', 'Shift', 'C']);
    expect(formatKeys('Mod+Shift+C', true)).toEqual(['⇧', '⌘', 'C']);
    expect(formatKeys('Mod+/', false)).toEqual(['Ctrl', '/']);
  });
});

describe('formatKeys on macOS', () => {
  it("draws modifiers in Apple's order whatever order they are written in", () => {
    expect(formatKeys('Shift+Mod+C', true)).toEqual(['⇧', '⌘', 'C']);
    expect(formatKeys('Mod+Shift+C', true)).toEqual(['⇧', '⌘', 'C']);
    expect(formatKeys('Mod+Shift+Y', true)).toEqual(['⇧', '⌘', 'Y']);
    expect(formatKeys('Mod+K', true)).toEqual(['⌘', 'K']);
  });

  it('keeps the written order off macOS', () => {
    expect(formatKeys('Shift+Mod+C', false)).toEqual(['Shift', 'Ctrl', 'C']);
  });

  it('uses the return and escape symbols on macOS only', () => {
    expect(formatKeys('Mod+Enter', true)).toEqual(['⌘', '↩']);
    expect(formatKeys('Shift+Enter', true)).toEqual(['⇧', '↩']);
    expect(formatKeys('Escape', true)).toEqual(['⎋']);
    expect(formatKeys('Mod+Enter', false)).toEqual(['Ctrl', 'Enter']);
    expect(formatKeys('Escape', false)).toEqual(['Escape']);
  });

  it('upper-cases single letters and leaves other keys alone', () => {
    expect(formatKeys('Mod+b', true)).toEqual(['⌘', 'B']);
    expect(formatKeys('Mod+/', true)).toEqual(['⌘', '/']);
    expect(formatKeys('Mod+Tab', false)).toEqual(['Ctrl', 'Tab']);
  });
});

describe('shortcutLabel', () => {
  it('joins symbols without separators on macOS and with + elsewhere', () => {
    expect(shortcutLabel('Mod+Shift+C', true)).toBe('⇧⌘C');
    expect(shortcutLabel('Mod+Shift+C', false)).toBe('Ctrl+Shift+C');
    expect(shortcutLabel('Mod+Enter', true)).toBe('⌘↩');
    expect(shortcutLabel('Mod+Enter', false)).toBe('Ctrl+Enter');
    expect(shortcutLabel('Mod+T', true)).toBe('⌘T');
  });
});

describe('keysFor and shortcutKeys', () => {
  it('uses macKeys only on macOS', () => {
    const s = { keys: 'Mod+Shift+Q', macKeys: 'Mod+Shift+Y' };
    expect(keysFor(s, true)).toBe('Mod+Shift+Y');
    expect(keysFor(s, false)).toBe('Mod+Shift+Q');
  });

  it('falls back to keys when a shortcut has no macKeys', () => {
    expect(keysFor({ keys: 'Mod+K' }, true)).toBe('Mod+K');
    expect(keysFor({ keys: 'Mod+K' }, false)).toBe('Mod+K');
    for (const fixed of FIXED_SHORTCUTS) expect(keysFor(fixed, true)).toBe(fixed.keys);
  });

  it('gives the QA panel Cmd+Shift+Y on macOS (Cmd+Shift+Q is Log Out) and Ctrl+Shift+Q elsewhere', () => {
    expect(shortcutKeys('toggleQa', true)).toBe('Mod+Shift+Y');
    expect(shortcutKeys('toggleQa', false)).toBe('Mod+Shift+Q');
    expect(shortcutLabel(shortcutKeys('toggleQa', true), true)).toBe('⇧⌘Y');
    expect(shortcutLabel(shortcutKeys('toggleQa', false), false)).toBe('Ctrl+Shift+Q');
  });

  it('returns the same keys on both platforms for shortcuts without macKeys', () => {
    for (const s of SHORTCUTS.filter((x) => !x.macKeys)) {
      expect(shortcutKeys(s.id, true)).toBe(s.keys);
      expect(shortcutKeys(s.id, false)).toBe(s.keys);
    }
  });

  it('returns an empty string for an unknown id', () => {
    expect(shortcutKeys('nope' as never, true)).toBe('');
  });

  it('has no duplicate key combinations on macOS either', () => {
    const mac = SHORTCUTS.map((s) => keysFor(s, true));
    expect(new Set(mac).size).toBe(SHORTCUTS.length);
  });

  it('never claims Cmd+Shift+Q on macOS', () => {
    expect(SHORTCUTS.map((s) => keysFor(s, true))).not.toContain('Mod+Shift+Q');
  });
});

describe('matchShortcut with macKeys', () => {
  it('toggles the QA panel with Cmd+Shift+Y on macOS, not Cmd+Shift+Q', () => {
    expect(matchShortcut(ev('Y', { metaKey: true, shiftKey: true }), true)).toBe('toggleQa');
    expect(matchShortcut(ev('y', { metaKey: true, shiftKey: true }), true)).toBe('toggleQa');
    expect(matchShortcut(ev('Q', { metaKey: true, shiftKey: true }), true)).toBeNull();
  });

  it('toggles the QA panel with Ctrl+Shift+Q elsewhere, not Ctrl+Shift+Y', () => {
    expect(matchShortcut(ev('Q', { ctrlKey: true, shiftKey: true }), false)).toBe('toggleQa');
    expect(matchShortcut(ev('Y', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });

  it('ignores Ctrl on macOS and Cmd elsewhere, and both pressed together', () => {
    expect(matchShortcut(ev('Y', { ctrlKey: true, shiftKey: true }), true)).toBeNull();
    expect(matchShortcut(ev('k', { ctrlKey: true }), true)).toBeNull();
    expect(matchShortcut(ev('k', { metaKey: true }), false)).toBeNull();
    expect(matchShortcut(ev('k', { metaKey: true, ctrlKey: true }), true)).toBeNull();
    expect(matchShortcut(ev('k', { metaKey: true, ctrlKey: true }), false)).toBeNull();
  });

  it('matches every shortcut with Cmd on macOS', () => {
    for (const s of SHORTCUTS) {
      const parts = keysFor(s, true).split('+');
      const key = parts[parts.length - 1] as string;
      const shiftKey = parts.includes('Shift');
      expect(
        matchShortcut(ev(shiftKey ? key.toUpperCase() : key, { metaKey: true, shiftKey }), true),
      ).toBe(s.id);
    }
  });

  it('refuses Option on macOS', () => {
    expect(matchShortcut(ev('k', { metaKey: true, altKey: true }), true)).toBeNull();
  });
});

describe('isMacPlatform', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('recognises Mac, iPhone and iPad platforms only', () => {
    for (const platform of ['MacIntel', 'iPhone', 'iPad']) {
      vi.stubGlobal('navigator', { platform });
      expect(isMacPlatform()).toBe(true);
    }
    for (const platform of ['Win32', 'Linux x86_64', '']) {
      vi.stubGlobal('navigator', { platform });
      expect(isMacPlatform()).toBe(false);
    }
  });

  it('is false without a navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isMacPlatform()).toBe(false);
  });
});

describe('Control and Option on macOS', () => {
  it('render as ⌃ and ⌥ in Apple order', () => {
    expect(formatKeys('Mod+Alt+Ctrl+K', true)).toEqual(['⌃', '⌥', '⌘', 'K']);
    expect(formatKeys('Ctrl+Alt+K', false)).toEqual(['Ctrl', 'Alt', 'K']);
  });
});
