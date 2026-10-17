import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Json = Record<string, unknown>;
const read = (name: string): Json =>
  JSON.parse(readFileSync(new URL(`../src-tauri/${name}`, import.meta.url), 'utf8')) as Json;

const base = read('tauri.conf.json');
const mac = read('tauri.macos.conf.json');
const windowsOf = (conf: Json) => (conf.app as { windows: Json[] }).windows;

/** Keys only the macOS window has (the native, overlaid title bar with the traffic lights). */
const MAC_ONLY = ['titleBarStyle', 'hiddenTitle', 'trafficLightPosition'] as const;

const without = (w: Json, keys: readonly string[]): Json =>
  Object.fromEntries(Object.entries(w).filter(([k]) => !keys.includes(k)));

describe('tauri.macos.conf.json', () => {
  it('has as many windows as the base config', () => {
    expect(windowsOf(mac)).toHaveLength(windowsOf(base).length);
  });

  it('repeats the base window exactly except decorations and the macOS-only keys (Tauri replaces the windows array, so a base edit must be copied here)', () => {
    windowsOf(base).forEach((baseWindow, i) => {
      const macWindow = windowsOf(mac)[i] as Json;
      expect(without(macWindow, ['decorations', ...MAC_ONLY])).toEqual(
        without(baseWindow, ['decorations']),
      );
    });
  });

  it('keeps the native decorations with an overlaid, hidden title on macOS only', () => {
    const [baseWindow] = windowsOf(base) as [Json];
    const [macWindow] = windowsOf(mac) as [Json];
    expect(baseWindow.decorations).toBe(false);
    for (const key of MAC_ONLY) expect(baseWindow).not.toHaveProperty(key);
    expect(macWindow.decorations).toBe(true);
    expect(macWindow.titleBarStyle).toBe('Overlay');
    expect(macWindow.hiddenTitle).toBe(true);
    expect(macWindow.trafficLightPosition).toEqual({
      x: expect.any(Number) as number,
      y: expect.any(Number) as number,
    });
  });

  it('still creates the window in setup, after the data migration', () => {
    for (const w of windowsOf(mac)) expect(w.create).toBe(false);
  });

  it('overrides nothing but the window list', () => {
    expect(Object.keys(mac).filter((k) => k !== '$schema')).toEqual(['app']);
    expect(Object.keys(mac.app as Json)).toEqual(['windows']);
  });
});
