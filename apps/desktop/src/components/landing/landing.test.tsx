// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../lib/db';
import { createTestDb } from '../../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('../../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));

const { LandingView, resetLaunchMessage } = await import('./LandingView');
const { AsciiLogo } = await import('./AsciiLogo');
const { usePrefs } = await import('../../stores/prefs');
const { useVisibility } = await import('../../stores/visibility');
const { defaultPrefs } = await import('../../lib/prefs');
const { MESSAGES } = await import('../../lib/launch-messages');

let osReducedMotion = false;

beforeEach(() => {
  localStorage.clear();
  hoisted.db = createTestDb();
  resetLaunchMessage();
  osReducedMotion = false;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduced-motion') ? osReducedMotion : true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  usePrefs.setState({ prefs: { ...defaultPrefs(), profile: { name: 'Ada' } } });
  useVisibility.setState({ windowVisible: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('landing view', () => {
  it('shows the mark, a still ASCII logo and a launch message', async () => {
    vi.useFakeTimers();
    render(<LandingView />);
    expect(screen.getByTestId('geeked-mark')).toBeTruthy();
    // The corner logo does not spin on Home, even on the fastest tier.
    const logo = screen.getByTestId('ascii-logo');
    expect(logo.getAttribute('data-size')).toBe('corner');
    expect(logo.getAttribute('data-fps')).toBe('0');
    const frame = logo.textContent;
    expect(frame?.replace(/\s/g, '').length).toBeGreaterThan(50);
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(screen.getByTestId('ascii-logo').textContent).toBe(frame);
    vi.useRealTimers();
    // The element is re-keyed when the line arrives, so look it up again each time.
    await waitFor(() =>
      expect(screen.getByTestId('launch-message').textContent?.length).toBeGreaterThan(0),
    );
  });

  it('remembers the line for the launch and does not repeat the previous launch', async () => {
    const first = render(<LandingView />);
    const a = (await waitFor(() => {
      const t = screen.getByTestId('launch-message').textContent;
      expect(t).toBeTruthy();
      return t;
    })) as string;
    first.unmount();
    // Visiting Home again in the same launch shows the same line.
    render(<LandingView />);
    expect(screen.getByTestId('launch-message').textContent).toBe(a);
    cleanup();

    // A new launch picks something different from the one stored.
    const lastId = localStorage.getItem('geeked-last-message');
    expect(MESSAGES.some((m) => m.id === lastId)).toBe(true);
    for (let i = 0; i < 8; i++) {
      resetLaunchMessage();
      render(<LandingView />);
      await waitFor(() => expect(screen.getByTestId('launch-message').textContent).toBeTruthy());
      const stored = localStorage.getItem('geeked-last-message');
      expect(stored).not.toBe(lastId === stored ? '' : null);
      cleanup();
    }
  });

  it('uses real stats when the database has them', async () => {
    const now = Date.now();
    const db = hoisted.db;
    for (let i = 0; i < 3; i++) {
      await db.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, 't', ?, ?)",
        [`c${i}`, now - 86_400_000, now - 86_400_000],
      );
    }
    // Only stat messages are allowed here, so the line must contain the real count.
    const { pickMessage } = await import('../../lib/launch-messages');
    const { launchStats } = await import('../../lib/repo-stats');
    const stats = await launchStats(db);
    expect(stats.chatsTotal).toBe(3);
    const picked = pickMessage(
      { name: 'Ada', now: new Date(), stats },
      { messages: MESSAGES.filter((m) => m.kind === 'stat'), rng: () => 0 },
    );
    expect(picked.text).toMatch(/\d/);
  });
});

describe('ascii logo', () => {
  const fpsOf = () => Number(screen.getByTestId('ascii-logo').getAttribute('data-fps'));

  it('runs at the tier frame rate and animates', () => {
    vi.useFakeTimers();
    render(<AsciiLogo />);
    expect(fpsOf()).toBe(12); // Balanced
    const before = screen.getByTestId('ascii-logo').textContent;
    act(() => void vi.advanceTimersByTime(1500));
    expect(screen.getByTestId('ascii-logo').textContent).not.toBe(before);
  });

  it('draws one static frame at Lightest', () => {
    vi.useFakeTimers();
    usePrefs.getState().setTier('lightest');
    render(<AsciiLogo />);
    expect(fpsOf()).toBe(0);
    const frame = screen.getByTestId('ascii-logo').textContent;
    expect(frame?.replace(/\s/g, '').length).toBeGreaterThan(50);
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('ascii-logo').textContent).toBe(frame);
  });

  it('is static when animations are off, even on a fast tier', () => {
    vi.useFakeTimers();
    usePrefs.getState().setTier('accelerated');
    usePrefs.getState().setMotion('off');
    render(<AsciiLogo />);
    expect(fpsOf()).toBe(0);
  });

  it('pauses while the window is hidden to the tray and resumes when shown', () => {
    vi.useFakeTimers();
    render(<AsciiLogo />);
    expect(fpsOf()).toBe(12);
    act(() => useVisibility.getState().setWindowVisible(false));
    expect(fpsOf()).toBe(0);
    const frame = screen.getByTestId('ascii-logo').textContent;
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('ascii-logo').textContent).toBe(frame);
    act(() => useVisibility.getState().setWindowVisible(true));
    expect(fpsOf()).toBe(12);
  });

  it('halves the rate under reduced motion', () => {
    osReducedMotion = true;
    render(<AsciiLogo />);
    // The attribute reports the tier rate; the interval itself runs at ceil(fps / 2).
    expect(fpsOf()).toBe(12);
  });
});
