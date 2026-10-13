import { create } from 'zustand';
import type { PingResult } from '../lib/bridge';
import { getBridgeClient } from '../lib/bridge-client';
import { isTauri } from '../lib/tauri';

export type BridgeStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'unavailable';

interface BridgeState {
  status: BridgeStatus;
  lastPing: PingResult | null;
  error: string | null;
  /** Start the sidecar (idempotent) and verify it with a ping. Concurrent callers share one attempt. */
  connect: () => Promise<void>;
  ping: () => Promise<void>;
}

let exitHooked = false;
let connecting: Promise<void> | null = null;

export const useBridgeStore = create<BridgeState>()((set, get) => {
  const start = async () => {
    set({ status: 'connecting', error: null });
    try {
      const client = getBridgeClient();
      if (!exitHooked) {
        exitHooked = true;
        client.onExit(() =>
          set({ status: 'error', error: 'The Claude bridge process stopped. Click to restart.' }),
        );
      }
      await client.connect();
      set({ status: 'ready' });
      set({ lastPing: await client.ping() });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  };

  return {
    status: 'idle',
    lastPing: null,
    error: null,

    connect() {
      if (!isTauri()) {
        set({ status: 'unavailable' });
        return Promise.resolve();
      }
      if (get().status === 'ready') return Promise.resolve();
      connecting ??= start().finally(() => (connecting = null));
      return connecting;
    },

    async ping() {
      // After a crash the status badge doubles as a restart button.
      if (get().status !== 'ready') {
        await get().connect();
        return;
      }
      try {
        set({ lastPing: await getBridgeClient().ping(), error: null });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
});
