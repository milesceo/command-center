import { create } from 'zustand';
import { effectiveTier, type PowerState, type TierId } from '../lib/performance';
import { isTauri } from '../lib/tauri';
import { usePrefs } from './prefs';

/** How often the power source is read (a `pmset` call in Rust, about 10 ms). */
const POLL_MS = 60_000;

interface PowerStore {
  /** Null outside the desktop app, before the first reading, and where it cannot be read. */
  power: PowerState | null;
  /** Starts polling (idempotent); returns nothing to undo because it lives as long as the app. */
  start: () => void;
}

interface RustPower {
  known: boolean;
  onBattery: boolean;
  lowPower: boolean;
}

let timer: ReturnType<typeof setInterval> | undefined;

/** The reading, `'unsupported'` where the platform has none, or null after a failed read. */
async function read(): Promise<PowerState | 'unsupported' | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const p = await invoke<RustPower>('system_power_state');
    return p.known ? { onBattery: p.onBattery, lowPower: p.lowPower } : 'unsupported';
  } catch {
    return null;
  }
}

export const usePower = create<PowerStore>()((set, get) => ({
  power: null,
  start() {
    if (timer || !isTauri()) return;
    const update = async () => {
      const reading = await read();
      // Not macOS (or no pmset): nothing will ever change, so stop asking.
      if (reading === 'unsupported') {
        if (timer) clearInterval(timer);
        return;
      }
      const next = reading;
      const prev = get().power;
      if (next?.onBattery !== prev?.onBattery || next?.lowPower !== prev?.lowPower) {
        set({ power: next });
      }
    };
    void update();
    timer = setInterval(() => void update(), POLL_MS);
  },
}));

/** The tier in effect now: the chosen one, capped on battery or in Low Power Mode if allowed. */
export function useEffectiveTier(): TierId {
  const tier = usePrefs((s) => s.prefs.performance.tier);
  const follow = usePrefs((s) => s.prefs.performance.followPower);
  const power = usePower((s) => s.power);
  return effectiveTier(tier, power, follow);
}
