// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/tauri', () => ({ isTauri: () => false, createTauriTransport: () => ({}) }));

const { Boot, SPLASH_MIN_MS, SPLASH_MAX_MS } = await import('./Boot');
const { useLockStore } = await import('./stores/lock');
const { useBridgeStore } = await import('./stores/bridge');
const { usePrefs } = await import('./stores/prefs');
const { defaultPrefs } = await import('./lib/prefs');

const FakeApp = () => <div data-testid="app">app</div>;
const loadApp = () => Promise.resolve({ App: FakeApp });

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  usePrefs.setState({ prefs: defaultPrefs() });
  useLockStore.setState({ phase: 'unlocked' });
  useBridgeStore.setState({ status: 'unavailable' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('Boot', () => {
  it('shows the splash with the spinning logo immediately, before the app is loaded', async () => {
    render(<Boot loadApp={() => new Promise(() => undefined)} />);
    expect(screen.getByTestId('splash')).toBeTruthy();
    const logo = screen.getByTestId('ascii-logo');
    expect(logo.getAttribute('data-size')).toBe('splash');
    expect(Number(logo.getAttribute('data-fps'))).toBeGreaterThan(0);
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('mounts the app behind the splash and keeps the splash for a minimum time', async () => {
    render(<Boot loadApp={loadApp} />);
    await settle(50);
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.getByTestId('splash').getAttribute('data-leaving')).toBe('false');

    await settle(SPLASH_MIN_MS - 200);
    expect(screen.getByTestId('splash').getAttribute('data-leaving')).toBe('false');

    await settle(400);
    expect(screen.getByTestId('splash').getAttribute('data-leaving')).toBe('true');
    await settle(400);
    expect(screen.queryByTestId('splash')).toBeNull();
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('waits for the lock state and the bridge before leaving', async () => {
    useLockStore.setState({ phase: 'checking' });
    useBridgeStore.setState({ status: 'connecting' });
    render(<Boot loadApp={loadApp} />);
    await settle(SPLASH_MIN_MS + 500);
    expect(screen.getByTestId('splash').getAttribute('data-leaving')).toBe('false');

    act(() => useLockStore.setState({ phase: 'locked' }));
    await settle(50);
    expect(screen.getByTestId('splash').getAttribute('data-leaving')).toBe('false');

    act(() => useBridgeStore.setState({ status: 'ready' }));
    await settle(50);
    expect(screen.getByTestId('splash').getAttribute('data-leaving')).toBe('true');
  });

  it('gives up waiting after the cap so a stuck bridge cannot trap the user', async () => {
    useBridgeStore.setState({ status: 'connecting' });
    render(<Boot loadApp={loadApp} />);
    await settle(SPLASH_MAX_MS - 100);
    expect(screen.getByTestId('splash').getAttribute('data-leaving')).toBe('false');
    await settle(300);
    expect(screen.getByTestId('splash').getAttribute('data-leaving')).toBe('true');
  });

  it('is a still frame at the Lightest tier', async () => {
    usePrefs.getState().setTier('lightest');
    render(<Boot loadApp={loadApp} />);
    expect(screen.getByTestId('ascii-logo').getAttribute('data-fps')).toBe('0');
  });
});
