// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/tauri', () => ({ isTauri: () => false, createTauriTransport: () => ({}) }));
vi.mock('../../lib/db', () => ({ getDb: () => Promise.reject(new Error('no database')) }));

const { OnboardingFlow, ONBOARDING_STEPS } = await import('./OnboardingFlow');
const { usePrefs } = await import('../../stores/prefs');
const { useLockStore } = await import('../../stores/lock');
const { useUiStore } = await import('../../stores/ui');
const { defaultPrefs } = await import('../../lib/prefs');

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  usePrefs.setState({ prefs: defaultPrefs() });
  useLockStore.setState({ phase: 'unlocked', hasPin: false, failures: 0, lockedUntil: 0 });
  useUiStore.setState({ view: 'chat' });
});
afterEach(cleanup);

const next = () => fireEvent.click(screen.getByRole('button', { name: /^(next|finish)/i }));
const typeName = (value: string) =>
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value } });

describe('onboarding flow', () => {
  it('has the five steps and starts on the name step', () => {
    render(<OnboardingFlow />);
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual(['name', 'pin', 'system', 'look', 'agents']);
    expect(
      screen.getByRole('heading', { name: /what should command center call you/i }),
    ).toBeTruthy();
    expect(screen.getByText(/change this any time in Settings/i)).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });

  it('requires a trimmed name of 1 to 32 characters', () => {
    render(<OnboardingFlow />);
    const nextButton = screen.getByRole('button', { name: /^next/i }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);
    typeName('   ');
    expect(nextButton.disabled).toBe(true);
    typeName('x'.repeat(33));
    expect(nextButton.disabled).toBe(true);
    expect(screen.getByText(/32 characters or fewer/i)).toBeTruthy();
    typeName('  Ada  ');
    expect(nextButton.disabled).toBe(false);
    next();
    expect(usePrefs.getState().prefs.profile.name).toBe('Ada');
    expect(screen.getByRole('heading', { name: /lock command center with a pin/i })).toBeTruthy();
  });

  it('continues with Enter from the name field', () => {
    render(<OnboardingFlow />);
    typeName('Ada');
    fireEvent.keyDown(screen.getByLabelText('Your name'), { key: 'Enter' });
    expect(screen.getByRole('heading', { name: /lock command center with a pin/i })).toBeTruthy();
  });

  it('sets a PIN after both fields match, hashes it, and explains there is no recovery', async () => {
    render(<OnboardingFlow />);
    typeName('Ada');
    next();

    expect(screen.getByText(/no way to recover a PIN/i)).toBeTruthy();
    expect(screen.getByText(/Argon2id/)).toBeTruthy();
    const nextButton = screen.getByRole('button', { name: /^next/i }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^PIN/), { target: { value: 'k3#Zp9' } });
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: 'k3#Zp8' } });
    expect(screen.getByText(/do not match/i)).toBeTruthy();
    expect(nextButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: 'k3#Zp9' } });
    expect(nextButton.disabled).toBe(false);
    next();

    await waitFor(() => expect(useLockStore.getState().hasPin).toBe(true));
    expect(
      await screen.findByRole('heading', { name: /how should command center behave/i }),
    ).toBeTruthy();
    // Nothing readable is stored.
    const stored = Object.values(localStorage).join('\n');
    expect(stored).not.toContain('k3#Zp9');
  });

  it('shows and hides the PIN with the toggle', () => {
    render(<OnboardingFlow />);
    typeName('Ada');
    next();
    const field = screen.getByLabelText(/^PIN/) as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show PIN' }));
    expect(field.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide PIN' }));
    expect(field.type).toBe('password');
  });

  it('lets the PIN be skipped for now', () => {
    render(<OnboardingFlow />);
    typeName('Ada');
    next();
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(screen.getByRole('heading', { name: /how should command center behave/i })).toBeTruthy();
    expect(useLockStore.getState().hasPin).toBe(false);
  });

  it('lets any earlier step be revisited, and remembers the step', () => {
    render(<OnboardingFlow />);
    typeName('Ada');
    next();
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(usePrefs.getState().prefs.onboarding.step).toBe(2);
    fireEvent.click(screen.getByRole('tab', { name: /name/i }));
    expect(
      screen.getByRole('heading', { name: /what should command center call you/i }),
    ).toBeTruthy();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Ada');
  });

  it('stores the tier, appearance and system choices as they are made', () => {
    render(<OnboardingFlow />);
    typeName('Ada');
    next();
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    // System step.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'When I close the window' })).getByRole('button', {
        name: 'Minimize to tray',
      }),
    );
    expect(usePrefs.getState().prefs.system.closeBehavior).toBe('tray');
    next();

    // Performance and appearance step.
    const slider = screen.getByLabelText('Performance tier');
    fireEvent.change(slider, { target: { value: '4' } });
    expect(usePrefs.getState().prefs.performance.tier).toBe('accelerated');
    expect(screen.getByText(/ASCII animation at 30 fps/)).toBeTruthy();
    fireEvent.change(slider, { target: { value: '0' } });
    expect(screen.getByText(/ASCII animation \(static frame\)/)).toBeTruthy();

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'Light' }),
    );
    fireEvent.click(screen.getByRole('radio', { name: /Forest/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accent #fb923c' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Density' })).getByRole('button', {
        name: 'Compact',
      }),
    );
    const { appearance } = usePrefs.getState().prefs;
    expect(appearance).toMatchObject({
      theme: 'light',
      palette: 'forest',
      accent: '#fb923c',
      density: 'compact',
    });
    expect(screen.getByTestId('preview-card')).toBeTruthy();
  });

  it('finishes on the agents step with providers skippable, and lands on Home', () => {
    render(<OnboardingFlow />);
    typeName('Ada');
    next();
    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));
    next(); // system
    next(); // look
    expect(screen.getByRole('heading', { name: /connect your ai agents/i })).toBeTruthy();
    expect(screen.getByTestId('provider-claude')).toBeTruthy();
    expect(screen.getByTestId('provider-openai')).toBeTruthy();
    expect(screen.getByTestId('provider-xai')).toBeTruthy();
    expect(screen.getByTestId('provider-add')).toBeTruthy();

    act(() => next());
    expect(usePrefs.getState().prefs.onboarding.completed).toBe(true);
    expect(useUiStore.getState().view).toBe('landing');
  });

  it('can be re-run from settings and keeps the current values as the starting point', () => {
    usePrefs.getState().setName('Grace');
    usePrefs.getState().completeOnboarding();
    usePrefs.getState().restartOnboarding();
    render(<OnboardingFlow />);
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Grace');
  });
});
