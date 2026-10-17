import { useEffect } from 'react';
import {
  FIXED_SHORTCUTS,
  SHORTCUTS,
  formatKeys,
  isMacPlatform,
  keysFor,
} from '../../lib/shortcuts';
import { useUiStore } from '../../stores/ui';

function Keys({ keys, mac }: { keys: string; mac: boolean }) {
  return (
    <span className="flex shrink-0 gap-1">
      {formatKeys(keys, mac).map((k, i) => (
        <kbd
          key={i}
          className="min-w-6 rounded border border-border-strong bg-surface px-1.5 py-0.5 text-center font-mono text-[11px] text-fg-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Lists every keyboard shortcut; driven by the same table the handler uses. */
export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const mac = isMacPlatform();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-md rounded-panel border border-border-strong bg-elevated p-4 shadow-xl"
      >
        <h2 id="shortcuts-title" className="text-sm font-semibold">
          Keyboard shortcuts
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {[...SHORTCUTS, ...FIXED_SHORTCUTS].map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4">
              <span className="text-fg-muted">{s.description}</span>
              <Keys keys={keysFor(s, mac)} mac={mac} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
