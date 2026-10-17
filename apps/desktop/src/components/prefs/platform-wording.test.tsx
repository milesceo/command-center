// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ secretsAvailable: { current: false } }));
vi.mock('../../lib/secrets', () => ({
  secrets: {
    available: () => hoisted.secretsAvailable.current,
    exists: () => Promise.resolve(false),
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
  },
}));
// No real window, autostart plugin or tray under test.
vi.mock('../../lib/system', () => ({
  system: {
    available: () => false,
    setCloseBehavior: () => Promise.resolve(),
    setAutostart: () => Promise.resolve(false),
    isAutostartEnabled: () => Promise.resolve(false),
  },
}));

const { SystemControls } = await import('./SystemControls');
const { AppearanceControls } = await import('./AppearanceControls');
const { ProviderCards } = await import('./ProviderCards');
const { usePrefs } = await import('../../stores/prefs');
const { useProviders } = await import('../../stores/providers');
const { defaultPrefs } = await import('../../lib/prefs');

const setPlatform = (value: string) =>
  Object.defineProperty(navigator, 'platform', { configurable: true, value });

beforeEach(() => {
  hoisted.secretsAvailable.current = false;
  const prefs = defaultPrefs();
  usePrefs.setState({ prefs: { ...prefs, system: { ...prefs.system, closeBehavior: 'tray' } } });
  // The cards refresh on mount; keep that off the bridge.
  useProviders.setState({
    infos: {},
    hasKey: { claude: false, openai: false, xai: false },
    loading: false,
    error: null,
    refresh: () => Promise.resolve(),
  });
});
afterEach(cleanup);

describe('SystemControls wording', () => {
  it('keeps the Windows wording off macOS', () => {
    setPlatform('Win32');
    render(<SystemControls />);
    expect(
      screen.getByRole('switch', { name: 'Launch Command Center when Windows starts' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Minimize to tray' })).toBeTruthy();
    expect(screen.getByText(/keeps running in the tray \(Open/)).toBeTruthy();
  });

  it('says log in and menu bar on macOS', () => {
    setPlatform('MacIntel');
    const { container } = render(<SystemControls />);
    expect(
      screen.getByRole('switch', { name: 'Launch Command Center when you log in' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Minimize to menu bar' })).toBeTruthy();
    expect(screen.getByText(/keeps running in the menu bar \(Open/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/Windows|tray/);
  });
});

describe('AppearanceControls wording', () => {
  it('follows Windows off macOS and macOS on macOS', () => {
    setPlatform('Win32');
    const first = render(<AppearanceControls />);
    expect(first.container.textContent).toContain('System follows Windows.');
    expect(first.container.textContent).toContain('System follows your Windows reduced-motion');
    cleanup();
    setPlatform('MacIntel');
    const { container } = render(<AppearanceControls />);
    expect(container.textContent).toContain('System follows macOS.');
    expect(container.textContent).toContain('System follows your macOS reduced-motion');
    expect(container.textContent).not.toContain('Windows');
  });
});

describe('ProviderCards wording', () => {
  const cards = () => within(screen.getByTestId('provider-cards'));

  it('names the Credential Manager off macOS when keys need the desktop app', () => {
    setPlatform('Win32');
    render(<ProviderCards />);
    expect(
      cards().getByText(/API keys are stored in the Windows Credential Manager, so adding one/),
    ).toBeTruthy();
  });

  it('names the Keychain on macOS when keys need the desktop app', () => {
    setPlatform('MacIntel');
    render(<ProviderCards />);
    expect(
      cards().getByText(/API keys are stored in the macOS Keychain, so adding one/),
    ).toBeTruthy();
    expect(screen.getByTestId('provider-cards').textContent).not.toContain('Credential Manager');
  });

  it('names the store in the key form and the saved state on each platform', () => {
    hoisted.secretsAvailable.current = true;
    setPlatform('MacIntel');
    render(<ProviderCards />);
    expect(cards().getByText(/Stored only in the macOS Keychain, never in/)).toBeTruthy();
    cleanup();

    setPlatform('Win32');
    render(<ProviderCards />);
    expect(
      cards().getByText(/Stored only in the Windows Credential Manager, never in/),
    ).toBeTruthy();
    cleanup();

    useProviders.setState({ hasKey: { claude: false, openai: false, xai: true } });
    setPlatform('MacIntel');
    render(<ProviderCards />);
    expect(cards().getByText('API key saved in macOS Keychain.')).toBeTruthy();
    cleanup();
    setPlatform('Win32');
    render(<ProviderCards />);
    expect(cards().getByText('API key saved in Windows Credential Manager.')).toBeTruthy();
  });
});
