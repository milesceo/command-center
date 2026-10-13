import { create } from 'zustand';
import { BridgeClient, type PingResult } from '../lib/bridge';
import { createTauriTransport, isTauri } from '../lib/tauri';

export type BridgeStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'unavailable';

interface BridgeState {
  status: BridgeStatus;
  lastPing: PingResult | null;
  error: string | null;
  /** Start the sidecar (once) and verify it with a ping. */
  connect: () => Promise<void>;
  ping: () => Promise<void>;
}

let client: BridgeClient | undefined;

export const useBridgeStore = create<BridgeState>()((set, get) => ({
  status: 'idle',
  lastPing: null,
  error: null,

  async connect() {
    if (!isTauri()) {
      set({ status: 'unavailable' });
      return;
    }
    if (get().status === 'connecting' || get().status === 'ready') return;
    set({ status: 'connecting', error: null });
    try {
      client ??= new BridgeClient(createTauriTransport());
      await client.connect();
      set({ status: 'ready' });
      await get().ping();
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  async ping() {
    if (!client) return;
    try {
      set({ lastPing: await client.ping(), error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
