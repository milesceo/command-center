import { BridgeClient } from './bridge';
import { createTauriTransport } from './tauri';

let client: BridgeClient | undefined;

/** The app-wide bridge client (one sidecar per app). */
export function getBridgeClient(): BridgeClient {
  client ??= new BridgeClient(createTauriTransport());
  return client;
}
