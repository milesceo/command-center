// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  tauri: true,
  invoke: null as unknown as (...args: unknown[]) => unknown,
}));
vi.mock('../lib/tauri', () => ({ isTauri: () => hoisted.tauri }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => hoisted.invoke(...args),
}));

const MIN = 60_000;
const reading = (onBattery: boolean, lowPower: boolean, known = true) => ({
  known,
  onBattery,
  lowPower,
});

/** A fresh power store (its poll timer is module state) and prefs store. */
async function setup(opts: { tauri?: boolean } = {}) {
  vi.resetModules();
  hoisted.tauri = opts.tauri ?? true;
  const power = await import('./power');
  const { usePrefs } = await import('./prefs');
  usePrefs.getState().reset();
  return { ...power, usePrefs };
}

/** Lets the store's lazy `import('@tauri-apps/api/core')` and the read finish (setImmediate is real). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
};

/** Advances one poll at a time and lets each read finish before the next. */
const tick = async (ms: number) => {
  for (let left = ms; left > 0; left -= MIN) {
    await vi.advanceTimersByTimeAsync(Math.min(MIN, left));
    await settle();
  }
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  hoisted.invoke = vi.fn(() => Promise.resolve(reading(false, false)));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('power store', () => {
  it('does nothing outside the desktop app', async () => {
    const t = await setup({ tauri: false });
    t.usePower.getState().start();
    await tick(10 * MIN);
    expect(hoisted.invoke).not.toHaveBeenCalled();
    expect(t.usePower.getState().power).toBeNull();
  });

  it('reads once at start, then once a minute, and start is idempotent', async () => {
    const t = await setup();
    t.usePower.getState().start();
    t.usePower.getState().start();
    await settle();
    expect(hoisted.invoke).toHaveBeenCalledTimes(1);
    expect(hoisted.invoke).toHaveBeenCalledWith('system_power_state');
    expect(t.usePower.getState().power).toEqual({ onBattery: false, lowPower: false });
    await tick(3 * MIN);
    expect(hoisted.invoke).toHaveBeenCalledTimes(4);
  });

  it('stops polling and keeps power null where it cannot be read (known: false)', async () => {
    hoisted.invoke = vi.fn(() => Promise.resolve(reading(true, true, false)));
    const t = await setup();
    t.usePower.getState().start();
    await settle();
    expect(t.usePower.getState().power).toBeNull();
    await tick(10 * MIN);
    expect(hoisted.invoke).toHaveBeenCalledTimes(1);
    expect(t.usePower.getState().power).toBeNull();
  });

  it('keeps polling after a failed read and picks up the next good one', async () => {
    hoisted.invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error('pmset failed'))
      .mockResolvedValue(reading(true, false));
    const t = await setup();
    t.usePower.getState().start();
    await settle();
    expect(t.usePower.getState().power).toBeNull();
    await tick(MIN);
    expect(hoisted.invoke).toHaveBeenCalledTimes(2);
    expect(t.usePower.getState().power).toEqual({ onBattery: true, lowPower: false });
  });

  it('updates the store on a change and not for an identical reading', async () => {
    hoisted.invoke = vi
      .fn()
      .mockResolvedValueOnce(reading(false, false))
      .mockResolvedValueOnce(reading(false, false))
      .mockResolvedValueOnce(reading(true, false))
      .mockResolvedValueOnce(reading(true, true))
      .mockResolvedValue(reading(true, true));
    const t = await setup();
    const updates = vi.fn();
    t.usePower.subscribe(updates);
    t.usePower.getState().start();
    await settle();
    expect(updates).toHaveBeenCalledTimes(1); // null -> AC
    const first = t.usePower.getState().power;
    await tick(MIN); // same reading
    expect(updates).toHaveBeenCalledTimes(1);
    expect(t.usePower.getState().power).toBe(first);
    await tick(MIN); // unplugged
    expect(updates).toHaveBeenCalledTimes(2);
    expect(t.usePower.getState().power).toEqual({ onBattery: true, lowPower: false });
    await tick(MIN); // Low Power Mode on
    expect(updates).toHaveBeenCalledTimes(3);
    await tick(2 * MIN); // unchanged twice
    expect(updates).toHaveBeenCalledTimes(3);
  });
});

describe('useEffectiveTier', () => {
  it('is the chosen tier until power is known, then capped while allowed', async () => {
    const t = await setup();
    t.usePrefs.getState().setTier('accelerated');
    const { result } = renderHook(() => t.useEffectiveTier());
    expect(result.current).toBe('accelerated');

    act(() => t.usePower.setState({ power: { onBattery: true, lowPower: false } }));
    expect(result.current).toBe('light');
    act(() => t.usePower.setState({ power: { onBattery: true, lowPower: true } }));
    expect(result.current).toBe('lightest');

    act(() => t.usePrefs.getState().setFollowPower(false));
    expect(result.current).toBe('accelerated');
    act(() => t.usePrefs.getState().setFollowPower(true));
    expect(result.current).toBe('lightest');

    act(() => t.usePower.setState({ power: { onBattery: false, lowPower: false } }));
    expect(result.current).toBe('accelerated');
  });

  it('never raises a low chosen tier', async () => {
    const t = await setup();
    t.usePrefs.getState().setTier('lightest');
    t.usePower.setState({ power: { onBattery: true, lowPower: false } });
    const { result } = renderHook(() => t.useEffectiveTier());
    expect(result.current).toBe('lightest');
  });
});
