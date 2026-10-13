import { describe, expect, it } from 'vitest';
import { SHORTCUTS, formatKeys, matchShortcut, type KeyEventLike } from './shortcuts';

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
    expect(formatKeys('Mod+Shift+C', true)).toEqual(['⌘', '⇧', 'C']);
    expect(formatKeys('Mod+/', false)).toEqual(['Ctrl', '/']);
  });
});
