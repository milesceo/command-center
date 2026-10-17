import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformCopy } from './platform-copy';

const on = (platform: string) => vi.stubGlobal('navigator', { platform });
afterEach(() => vi.unstubAllGlobals());

describe('platformCopy', () => {
  it.each(['Win32', 'Linux x86_64', ''])('keeps the original Windows wording on %j', (p) => {
    on(p);
    expect(platformCopy.credentialStore()).toBe('Windows Credential Manager');
    expect(platformCopy.startAtLogin()).toBe('Launch Command Center when Windows starts');
    expect(platformCopy.tray()).toBe('tray');
    expect(platformCopy.os()).toBe('Windows');
  });

  it('uses Keychain, log in and menu bar on macOS', () => {
    on('MacIntel');
    expect(platformCopy.credentialStore()).toBe('macOS Keychain');
    expect(platformCopy.startAtLogin()).toBe('Launch Command Center when you log in');
    expect(platformCopy.tray()).toBe('menu bar');
    expect(platformCopy.os()).toBe('macOS');
  });

  it('never mentions Windows on macOS', () => {
    on('MacIntel');
    for (const text of Object.values(platformCopy).map((f) => f())) {
      expect(text).not.toMatch(/windows/i);
    }
  });

  it('is evaluated on each call, not frozen at import', () => {
    on('Win32');
    expect(platformCopy.tray()).toBe('tray');
    on('MacIntel');
    expect(platformCopy.tray()).toBe('menu bar');
  });
});
