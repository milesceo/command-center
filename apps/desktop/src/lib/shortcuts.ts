/** The app's keyboard shortcuts: one list drives both the handler and the help dialog. */

export type ShortcutId =
  | 'commandPalette'
  | 'copyLastCode'
  | 'togglePreview'
  | 'toggleDiffMode'
  | 'toggleSidebar'
  | 'showShortcuts'
  | 'toggleQa';

export interface Shortcut {
  id: ShortcutId;
  /** `Mod` is Ctrl on Windows/Linux and Cmd on macOS. */
  keys: string;
  /** A different combination on macOS, where `keys` would collide with a system shortcut. */
  macKeys?: string;
  description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'commandPalette', keys: 'Mod+K', description: 'Open the command palette' },
  { id: 'copyLastCode', keys: 'Mod+Shift+C', description: 'Copy the last code block' },
  { id: 'togglePreview', keys: 'Mod+Shift+P', description: 'Show or hide the preview panel' },
  {
    id: 'toggleDiffMode',
    keys: 'Mod+Shift+D',
    description: 'Switch diffs between side-by-side and inline',
  },
  { id: 'toggleSidebar', keys: 'Mod+B', description: 'Show or hide the sidebar' },
  { id: 'showShortcuts', keys: 'Mod+/', description: 'Show this list' },
  {
    id: 'toggleQa',
    keys: 'Mod+Shift+Q',
    // Cmd+Shift+Q is "Log Out" on macOS: the system takes it before the app sees it.
    macKeys: 'Mod+Shift+Y',
    description: 'Show or hide the QA checklist (when enabled)',
  },
];

/** Shortcuts that are built into controls rather than handled globally (documented in the dialog). */
export const FIXED_SHORTCUTS: readonly { keys: string; description: string }[] = [
  { keys: 'Enter', description: 'Send the message' },
  { keys: 'Shift+Enter', description: 'New line in the message' },
  { keys: 'Escape', description: 'Close a dialog or cancel a pending comparison' },
];

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);

/** The key combination a shortcut uses on this platform. */
export const keysFor = (shortcut: { keys: string; macKeys?: string }, mac: boolean): string =>
  (mac ? shortcut.macKeys : undefined) ?? shortcut.keys;

/** The key combination for a shortcut id on this platform. */
export function shortcutKeys(id: ShortcutId, mac: boolean): string {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  return shortcut ? keysFor(shortcut, mac) : '';
}

/** Returns the shortcut a key event triggers, or null. Matching is exact: extra modifiers do not match. */
export function matchShortcut(e: KeyEventLike, mac: boolean): ShortcutId | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (!mod || other || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const shortcut of SHORTCUTS) {
    const parts = keysFor(shortcut, mac).split('+');
    const wanted = (parts[parts.length - 1] as string).toLowerCase();
    if (e.shiftKey === parts.includes('Shift') && key === wanted) return shortcut.id;
  }
  return null;
}

/** macOS draws modifiers in this order (⌃⌥⇧⌘), whatever order a combination is written in. */
const MAC_ORDER: Record<string, number> = { Ctrl: 0, Alt: 1, Shift: 2, Mod: 3 };
const MAC_KEYS: Record<string, string> = { Enter: '↩', Escape: '⎋' };

/**
 * Display form of a key combination for the current platform ("Ctrl + Shift + C" / "⇧ ⌘ C"),
 * with modifiers in Apple's order on macOS so they read like the native menus.
 */
export function formatKeys(keys: string, mac: boolean): string[] {
  const parts = keys.split('+');
  const ordered = mac
    ? [...parts].sort((a, b) => (MAC_ORDER[a] ?? 9) - (MAC_ORDER[b] ?? 9))
    : parts;
  return ordered.map((part) => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'Shift') return mac ? '⇧' : 'Shift';
    if (part === 'Ctrl' && mac) return '⌃';
    if (part === 'Alt' && mac) return '⌥';
    if (mac && MAC_KEYS[part]) return MAC_KEYS[part];
    return part.length === 1 ? part.toUpperCase() : part;
  });
}

/** One-line label for tooltips and hints: "⇧⌘C" on macOS, "Ctrl+Shift+C" elsewhere. */
export function shortcutLabel(keys: string, mac: boolean): string {
  return formatKeys(keys, mac).join(mac ? '' : '+');
}
