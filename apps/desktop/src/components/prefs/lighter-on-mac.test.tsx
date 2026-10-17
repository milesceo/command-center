// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/secrets', () => ({
  secrets: {
    available: () => false,
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

const { PerformanceControls } = await import('./PerformanceControls');
const { SystemControls } = await import('./SystemControls');
const { ProviderCards } = await import('./ProviderCards');
const { usePrefs } = await import('../../stores/prefs');
const { usePower } = await import('../../stores/power');
const { useProviders } = await import('../../stores/providers');
const { PROVIDER_IDS } = await import('@command-center/protocol');

const ON_HINT = 'On battery: at most Light. Low Power Mode: Lightest.';
const OFF_HINT = 'Off: the chosen tier applies on battery too.';

beforeEach(() => {
  usePrefs.getState().reset();
  usePower.setState({ power: null });
  useProviders.setState({
    infos: {},
    hasKey: { claude: false, openai: false, xai: false },
    loading: false,
    error: null,
    refresh: () => Promise.resolve(),
  });
});
afterEach(cleanup);

const summary = () => {
  const live = screen.getByTestId('performance-controls').querySelector('[aria-live="polite"]');
  if (!(live instanceof HTMLElement)) throw new Error('no aria-live summary');
  return live;
};

describe('PerformanceControls power row', () => {
  it('hides the battery switch while power is unknown (not macOS, or not read yet)', () => {
    render(<PerformanceControls />);
    expect(screen.queryByRole('switch', { name: 'Lighter on battery' })).toBeNull();
    expect(screen.queryByText(ON_HINT)).toBeNull();
  });

  it('shows the switch once power is known, and it toggles followPower with matching hints', () => {
    usePower.setState({ power: { onBattery: false, lowPower: false } });
    render(<PerformanceControls />);
    const toggle = screen.getByRole('switch', { name: 'Lighter on battery' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(ON_HINT)).toBeTruthy();

    fireEvent.click(toggle);
    expect(usePrefs.getState().prefs.performance.followPower).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(OFF_HINT)).toBeTruthy();
    expect(screen.queryByText(ON_HINT)).toBeNull();

    fireEvent.click(toggle);
    expect(usePrefs.getState().prefs.performance.followPower).toBe(true);
  });

  it('announces the cap inside the live summary on battery', () => {
    usePrefs.getState().setTier('enhanced');
    usePower.setState({ power: { onBattery: true, lowPower: false } });
    render(<PerformanceControls />);
    const text = summary().textContent ?? '';
    expect(text).toContain('Running at Light now (on battery); Enhanced returns on power.');
  });

  it('names Low Power Mode when that is the reason', () => {
    usePower.setState({ power: { onBattery: false, lowPower: true } });
    render(<PerformanceControls />);
    expect(summary().textContent).toContain(
      'Running at Lightest now (Low Power Mode); Balanced returns on power.',
    );
  });

  it('shows no cap note on mains power, below the cap, or with the switch off', () => {
    usePower.setState({ power: { onBattery: false, lowPower: false } });
    const { unmount } = render(<PerformanceControls />);
    expect(summary().textContent).not.toContain('Running at');
    unmount();

    usePrefs.getState().setTier('lightest');
    usePower.setState({ power: { onBattery: true, lowPower: true } });
    const second = render(<PerformanceControls />);
    expect(summary().textContent).not.toContain('Running at');
    second.unmount();

    usePrefs.getState().setTier('accelerated');
    usePrefs.getState().setFollowPower(false);
    render(<PerformanceControls />);
    expect(summary().textContent).not.toContain('Running at');
  });
});

describe('SystemControls idle stop', () => {
  it('sets bridgeIdleMinutes from the segmented control, Never included', () => {
    render(<SystemControls />);
    const group = screen.getByRole('group', { name: 'Stop the AI helper when idle' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Never', '5 min', '10 min', '30 min', '60 min']);
    expect(within(group).getByRole('button', { name: '10 min' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(within(group).getByRole('button', { name: '30 min' }));
    expect(usePrefs.getState().prefs.system.bridgeIdleMinutes).toBe(30);
    expect(screen.getByText(/stops after 30 minutes without a request/)).toBeTruthy();

    fireEvent.click(within(group).getByRole('button', { name: 'Never' }));
    expect(usePrefs.getState().prefs.system.bridgeIdleMinutes).toBe(0);
    expect(screen.getByText(/keeps running while the app is open/)).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Never' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

describe('ProviderCards first check', () => {
  it('says Checking… and disables sign-in while the first check runs', () => {
    useProviders.setState({ loading: true });
    render(<ProviderCards />);
    for (const id of PROVIDER_IDS) {
      const card = screen.getByTestId(`provider-${id}`);
      expect(within(card).getByText('Checking…')).toBeTruthy();
      expect(within(card).queryByText('Not connected')).toBeNull();
      const signIn = within(card).queryByRole('button', { name: /Sign in with/ });
      if (signIn) expect((signIn as HTMLButtonElement).disabled).toBe(true);
    }
    expect(
      within(screen.getByTestId('provider-claude')).getByRole('button', { name: /Sign in with/ }),
    ).toBeTruthy();
  });

  it('shows the real badge and enables sign-in once the check is done', () => {
    render(<ProviderCards />);
    const card = screen.getByTestId('provider-claude');
    expect(within(card).queryByText('Checking…')).toBeNull();
    expect(within(card).getByText(/^(Not checked|Not connected)$/)).toBeTruthy();
    const signIn = within(card).getByRole('button', { name: /Sign in with/ }) as HTMLButtonElement;
    expect(signIn.disabled).toBe(false);
  });

  it('a later refresh keeps the known badge instead of Checking…', () => {
    useProviders.setState({
      loading: true,
      infos: {
        claude: {
          id: 'claude',
          name: 'Claude',
          authMethods: ['subscription'],
          auth: 'signed_in',
          authVia: 'subscription',
          models: [],
          note: '',
        },
      },
    });
    render(<ProviderCards />);
    const card = screen.getByTestId('provider-claude');
    expect(within(card).queryByText('Checking…')).toBeNull();
    expect(within(card).getByText('Connected')).toBeTruthy();
  });
});
