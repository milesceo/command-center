import { create } from 'zustand';
import type { PingResult } from '../lib/bridge';
import { getBridgeClient } from '../lib/bridge-client';
import { isTauri } from '../lib/tauri';
import { usePrefs } from './prefs';

export type BridgeStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'unavailable';

interface BridgeState {
  status: BridgeStatus;
  lastPing: PingResult | null;
  error: string | null;
  /**
   * Start the sidecar (idempotent) and verify it with a ping. Concurrent callers share one
   * attempt. The sidecar is not started at launch: the first chat, provider check or usage
   * request calls this.
   */
  connect: () => Promise<void>;
  ping: () => Promise<void>;
  /** Stops the sidecar on purpose (idle shutdown); `connect` starts it again. */
  stop: () => Promise<void>;
}

let exitHooked = false;
let connecting: Promise<void> | null = null;
/** An idle stop in progress; a `connect` waits for it, then starts a fresh bridge. */
let stopping: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Restarts the idle countdown from now (after every finished request, and once connected). */
function scheduleIdleStop(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  const minutes = usePrefs.getState().prefs.system.bridgeIdleMinutes;
  if (!minutes) return;
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    const store = useBridgeStore.getState();
    if (store.status !== 'ready' || !usePrefs.getState().prefs.system.bridgeIdleMinutes) return;
    // Something is still running (a long chat): look again a full period later.
    if (getBridgeClient().isBusy()) scheduleIdleStop();
    else void store.stop();
  }, minutes * 60_000);
}

export const useBridgeStore = create<BridgeState>()((set, get) => {
  const start = async () => {
    set({ status: 'connecting', error: null });
    try {
      const client = getBridgeClient();
      if (!exitHooked) {
        exitHooked = true;
        // An intentional stop unsubscribes first and stale exits are filtered by generation in
        // the client, so an exit that reaches here is a real crash.
        client.onExit(() =>
          set({ status: 'error', error: 'The Claude bridge process stopped. Click to restart.' }),
        );
        client.onSettled(scheduleIdleStop);
      }
      await client.connect();
      set({ status: 'ready', error: null });
      set({ lastPing: await client.ping() });
      scheduleIdleStop();
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  };

  return {
    // Outside the desktop app there is no bridge to start (web preview, Storybook).
    status: isTauri() ? 'idle' : 'unavailable',
    lastPing: null,
    error: null,

    connect() {
      if (!isTauri()) {
        set({ status: 'unavailable' });
        return Promise.resolve();
      }
      if (get().status === 'ready') return Promise.resolve();
      connecting ??= (async () => {
        if (stopping) await stopping;
        await start();
      })().finally(() => (connecting = null));
      return connecting;
    },

    async ping() {
      // After a crash (or an idle stop) the status badge doubles as a start button.
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

    stop() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = undefined;
      if (get().status !== 'ready') return stopping ?? Promise.resolve();
      // Not 'ready' any more from this moment, so a chat sent meanwhile waits and starts afresh.
      set({ status: 'idle', lastPing: null, error: null });
      stopping = getBridgeClient()
        .stop()
        .catch((err: unknown) => {
          set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => (stopping = null));
      return stopping;
    },
  };
});

/** Starts the bridge if needed; throws a readable error when it cannot run. */
export async function ensureBridge(): Promise<void> {
  await useBridgeStore.getState().connect();
  const { status, error } = useBridgeStore.getState();
  if (status !== 'ready') throw new Error(error ?? 'The Claude bridge is not available.');
}

// Changing "Stop the AI helper when idle" takes effect at once: Never cancels the countdown, a
// new length restarts it.
usePrefs.subscribe((state, prev) => {
  if (state.prefs.system.bridgeIdleMinutes === prev.prefs.system.bridgeIdleMinutes) return;
  if (useBridgeStore.getState().status === 'ready') scheduleIdleStop();
  else if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
});
