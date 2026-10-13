import type { BridgeTransport } from './bridge';

/** True when running inside the Tauri webview (false in a plain browser, e.g. `pnpm dev:web`). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Transport backed by the Rust side, which owns the sidecar process.
 * Tauri APIs are imported lazily so the web preview never loads them.
 */
export function createTauriTransport(): BridgeTransport {
  return {
    async start() {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('bridge_start');
    },
    async send(line) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('bridge_send', { line });
    },
    async onLine(handler) {
      const { listen } = await import('@tauri-apps/api/event');
      return listen<string>('bridge://line', (e) => handler(e.payload));
    },
  };
}
