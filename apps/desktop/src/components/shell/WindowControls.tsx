import { Minus, Plus, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { isTauri } from '../../lib/tauri';
import { usesNativeTitleBar } from '../../lib/window-chrome';

type Action = 'close' | 'minimize' | 'maximize';

interface Light {
  action: Action;
  label: string;
  icon: LucideIcon;
  color: string;
}

const LIGHTS: readonly Light[] = [
  { action: 'minimize', label: 'Minimize window', icon: Minus, color: 'var(--traffic-minimize)' },
  { action: 'maximize', label: 'Maximize window', icon: Plus, color: 'var(--traffic-maximize)' },
  { action: 'close', label: 'Close window', icon: X, color: 'var(--traffic-close)' },
];

/** The Tauri window API is loaded on first click so browsers and tests never touch it. */
async function run(action: Action): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  if (action === 'close') await win.close();
  else if (action === 'minimize') await win.minimize();
  else await win.toggleMaximize();
}

/**
 * macOS-style traffic lights for the frameless window on Windows and Linux. Hidden outside the
 * desktop app and on macOS (which shows its own), and gray while the window is not focused, as
 * on a Mac. Place it inside an element with `data-tauri-drag-region` so the rest of the bar
 * still drags the window.
 */
export function WindowControls({ className }: { className?: string }) {
  const [focused, setFocused] = useState(() =>
    typeof document === 'undefined' ? true : document.hasFocus(),
  );

  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);

  if (!isTauri() || usesNativeTitleBar()) return null;

  return (
    <div
      role="group"
      aria-label="Window controls"
      data-focused={focused}
      className={cn('group/lights flex items-center gap-2', className)}
    >
      {LIGHTS.map(({ action, label, icon: Icon, color }) => (
        <button
          key={action}
          type="button"
          aria-label={label}
          title={label}
          onClick={() => void run(action)}
          className="grid size-3 place-items-center rounded-full text-black/65 transition-colors"
          style={{ background: focused ? color : 'var(--border-strong)' }}
        >
          <Icon
            size={8}
            strokeWidth={3}
            aria-hidden="true"
            className="opacity-0 group-hover/lights:opacity-100"
          />
        </button>
      ))}
    </div>
  );
}

/** A slim title strip for the classic layout, which has no toolbar of its own. */
export function ClassicTitleBar() {
  if (!isTauri()) return null;
  const native = usesNativeTitleBar();
  return (
    <header
      data-tauri-drag-region
      // On macOS the strip matches the other toolbars' height, so one traffic-light position fits all.
      className={cn(
        'flex shrink-0 items-center border-b border-border bg-surface px-3',
        native ? 'h-11' : 'h-9',
      )}
    >
      <span data-tauri-drag-region className={native ? 'w-[64px]' : 'w-14'} />
      <span
        data-tauri-drag-region
        className="mx-auto font-mono text-[11px] tracking-tight text-fg-muted select-none"
      >
        command center
      </span>
      {native ? (
        <span data-tauri-drag-region className="w-[64px]" />
      ) : (
        <WindowControls className="w-14 justify-end" />
      )}
    </header>
  );
}
