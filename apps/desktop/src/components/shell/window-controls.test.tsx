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

beforeEach(() => {
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
