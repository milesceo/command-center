import type { ProviderId } from '@command-center/protocol';
import { isTauri } from './tauri';

/**
 * Provider API keys. In the desktop app they live in the operating system's credential store
 * (Windows Credential Manager) via Rust; nothing here writes a key to SQLite, localStorage,
 * files or logs. In a plain browser there is no credential store, so keys are refused rather
 * than kept anywhere weaker.
 */

export class SecretsUnavailableError extends Error {
  constructor() {
    super('API keys can only be stored in the Command Center desktop app (OS credential store).');
  }
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new SecretsUnavailableError();
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

export const secrets = {
  available: () => isTauri(),
  set: (provider: ProviderId, key: string) => invoke<void>('secret_set', { provider, key }),
  exists: async (provider: ProviderId): Promise<boolean> =>
    isTauri() ? invoke<boolean>('secret_exists', { provider }) : false,
  /** Reads a key to hand to the bridge for one request. Never store the result. */
  get: async (provider: ProviderId): Promise<string | null> =>
    isTauri() ? invoke<string | null>('secret_get', { provider }) : null,
  delete: (provider: ProviderId) => invoke<void>('secret_delete', { provider }),
  wipe: async (): Promise<void> => {
    if (isTauri()) await invoke<void>('secret_wipe');
  },
};
