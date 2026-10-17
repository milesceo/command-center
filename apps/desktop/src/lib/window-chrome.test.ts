import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_LIGHTS_INSET, usesNativeTitleBar } from './window-chrome';

const desktop = (inTauri: boolean) =>
  vi.stubGlobal('window', inTauri ? { __TAURI_INTERNALS__: {} } : {});
const platform = (value: string) => vi.stubGlobal('navigator', { platform: value });

afterEach(() => vi.unstubAllGlobals());

describe('usesNativeTitleBar', () => {
  it('is true only in the desktop app on macOS', () => {
    desktop(true);
    platform('MacIntel');
    expect(usesNativeTitleBar()).toBe(true);
  });

  it('is false in the desktop app on Windows and Linux', () => {
    desktop(true);
    platform('Win32');
    expect(usesNativeTitleBar()).toBe(false);
    platform('Linux x86_64');
    expect(usesNativeTitleBar()).toBe(false);
  });

  it('is false in a browser on macOS (no Tauri, so no native window)', () => {
    desktop(false);
    platform('MacIntel');
    expect(usesNativeTitleBar()).toBe(false);
  });

  it('is false in a browser elsewhere and without a window at all', () => {
    desktop(false);
    platform('Win32');
    expect(usesNativeTitleBar()).toBe(false);
    vi.stubGlobal('window', undefined);
    platform('MacIntel');
    expect(usesNativeTitleBar()).toBe(false);
  });

  it('keeps room for the traffic lights as a Tailwind left padding', () => {
    expect(NATIVE_LIGHTS_INSET).toMatch(/^pl-\[\d+px\]$/);
  });
});
