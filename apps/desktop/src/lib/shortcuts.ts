/** The app's keyboard shortcuts: one list drives both the handler and the help dialog. */

export type ShortcutId =
  | 'commandPalette'
  | 'copyLastCode'
  | 'togglePreview'
  | 'toggleDiffMode'
  | 'toggleSidebar'
  | 'showShortcuts';

export interface Shortcut {
  id: ShortcutId;
  /** `Mod` is Ctrl on Windows/Linux and Cmd on macOS. */
  keys: string;
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

/** Returns the shortcut a key event triggers, or null. Matching is exact: extra modifiers do not match. */
export function matchShortcut(e: KeyEventLike, mac: boolean): ShortcutId | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (!mod || other || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const shortcut of SHORTCUTS) {
    const parts = shortcut.keys.split('+');
    const wanted = (parts[parts.length - 1] as string).toLowerCase();
    if (e.shiftKey === parts.includes('Shift') && key === wanted) return shortcut.id;
  }
  return null;
}

/** Display form of a key combination for the current platform ("Ctrl + Shift + C" / "⌘ ⇧ C"). */
export function formatKeys(keys: string, mac: boolean): string[] {
  return keys.split('+').map((part) => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'Shift') return mac ? '⇧' : 'Shift';
    return part.length === 1 ? part.toUpperCase() : part;
  });
}
