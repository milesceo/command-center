import type { CloseBehavior } from './prefs';
import { isTauri } from './tauri';

/**
 * Operating-system integration: start with Windows, what closing the window does, and the
 * events the tray menu sends. All of it is a no-op outside the desktop app.
 */

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export const system = {
  available: () => isTauri(),

  /** Registers or removes the app from Windows startup. Returns the state that resulted. */
  async setAutostart(enabled: boolean): Promise<boolean> {
    if (!isTauri()) return false;
    const plugin = await import('@tauri-apps/plugin-autostart');
    if (enabled) await plugin.enable();
    else await plugin.disable();
    return plugin.isEnabled();
  },

  async isAutostartEnabled(): Promise<boolean> {
    if (!isTauri()) return false;
    const plugin = await import('@tauri-apps/plugin-autostart');
    return plugin.isEnabled();
  },

  async setCloseBehavior(behavior: CloseBehavior): Promise<void> {
    if (!isTauri()) return;
    await invoke('system_set_close_behavior', { behavior });
  },
};

export interface TrayHandlers {
  onNewChat: () => void;
  onLock: () => void;
  /** The window was hidden to the tray (false) or shown again (true). */
  onVisibility: (visible: boolean) => void;
}

/** Subscribes to the events Rust emits for tray actions. Returns the unsubscribe function. */
export async function listenToTray(handlers: TrayHandlers): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  const unlisteners = await Promise.all([
    listen('command-center://new-chat', () => handlers.onNewChat()),
    listen('command-center://lock', () => handlers.onLock()),
    listen<boolean>('command-center://window-visible', (e) => handlers.onVisibility(e.payload)),
  ]);
  return () => {
    for (const off of unlisteners) off();
  };
}
