// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  tauri: { current: true },
  win: { close: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn() },
}));

vi.mock('../../lib/tauri', () => ({ isTauri: () => hoisted.tauri.current }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => hoisted.win }));

const { ClassicTitleBar, WindowControls } = await import('./WindowControls');

const setPlatform = (value: string) =>
  Object.defineProperty(navigator, 'platform', { configurable: true, value });

beforeEach(() => {
  setPlatform('Win32');
  hoisted.tauri.current = true;
  Object.values(hoisted.win).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe('WindowControls', () => {
  it('closes, minimizes and maximizes the window', async () => {
    render(<WindowControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
    await waitFor(() => expect(hoisted.win.minimize).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }));
    await waitFor(() => expect(hoisted.win.toggleMaximize).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    await waitFor(() => expect(hoisted.win.close).toHaveBeenCalledTimes(1));
  });

  it('renders nothing in a browser', () => {
    hoisted.tauri.current = false;
    const { container } = render(<WindowControls />);
    expect(container.firstChild).toBeNull();
  });

  it('grays out while the window is not focused', () => {
    render(<WindowControls />);
    const group = screen.getByRole('group', { name: 'Window controls' });
    fireEvent(window, new Event('focus'));
    expect(group.getAttribute('data-focused')).toBe('true');
    fireEvent(window, new Event('blur'));
    expect(group.getAttribute('data-focused')).toBe('false');
    fireEvent(window, new Event('focus'));
    expect(group.getAttribute('data-focused')).toBe('true');
  });
});

describe('ClassicTitleBar', () => {
  it('is a drag region with the controls in the desktop app, and absent in a browser', () => {
    const { container, rerender } = render(<ClassicTitleBar />);
    expect(container.querySelector('[data-tauri-drag-region]')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Window controls' })).toBeTruthy();
    hoisted.tauri.current = false;
    rerender(<ClassicTitleBar />);
    expect(container.firstChild).toBeNull();
  });
});

describe('on macOS', () => {
  beforeEach(() => setPlatform('MacIntel'));

  it('hides the custom lights in the desktop app (the native ones show)', () => {
    const { container } = render(<WindowControls />);
    expect(container.firstChild).toBeNull();
  });

  it('gives the classic title strip the toolbar height and two 64px spacers instead of the lights', () => {
    const { container } = render(<ClassicTitleBar />);
    const header = container.querySelector('header')!;
    expect(header.className).toContain('h-11');
    expect(header.className).not.toContain('h-9');
    expect(screen.queryByRole('group', { name: 'Window controls' })).toBeNull();
    const spacers = [...header.querySelectorAll('span')].filter((s) =>
      s.className.includes('w-[64px]'),
    );
    expect(spacers).toHaveLength(2);
    expect(spacers.every((s) => s.hasAttribute('data-tauri-drag-region'))).toBe(true);
    expect(header.textContent).toContain('command center');
  });

  it('still renders nothing in a browser', () => {
    hoisted.tauri.current = false;
    expect(render(<WindowControls />).container.firstChild).toBeNull();
    cleanup();
    expect(render(<ClassicTitleBar />).container.firstChild).toBeNull();
  });
});

describe('on Windows and Linux', () => {
  it.each(['Win32', 'Linux x86_64'])('%s keeps the custom lights and the h-9 strip', (p) => {
    setPlatform(p);
    const { container } = render(<ClassicTitleBar />);
    const header = container.querySelector('header')!;
    expect(header.className).toContain('h-9');
    expect(header.querySelector('.w-\\[64px\\]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Window controls' })).toBeTruthy();
  });
});
