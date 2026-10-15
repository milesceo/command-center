// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinCircles, clampPin } from './PinCircles';

afterEach(cleanup);

function Harness({
  onSubmit,
  initial = '',
  disabled = false,
  keepFocus = false,
}: {
  onSubmit?: () => void;
  initial?: string;
  disabled?: boolean;
  keepFocus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [reveal, setReveal] = useState(false);
  return (
    <>
      <PinCircles
        value={value}
        onChange={setValue}
        {...(onSubmit ? { onSubmit } : {})}
        reveal={reveal}
        onRevealChange={setReveal}
        disabled={disabled}
        autoFocus
        keepFocus={keepFocus}
      />
      <button type="button">elsewhere</button>
    </>
  );
}

const pinInput = () => screen.getByLabelText('PIN', { selector: 'input' }) as HTMLInputElement;
const slots = () => [...document.querySelectorAll<HTMLElement>('[data-slot]')];

describe('clampPin', () => {
  it('removes control characters and keeps at most eight characters', () => {
    expect(clampPin('ab\tc\nd')).toBe('abcd');
    expect(clampPin('123456789012')).toBe('12345678');
    expect(clampPin('😀😀😀😀😀😀😀😀😀')).toBe('😀'.repeat(8));
  });
});

describe('PinCircles', () => {
  it('shows eight circle slots, the first four marked as the required minimum', () => {
    render(<Harness />);
    const all = slots();
    expect(all).toHaveLength(8);
    expect(all.slice(0, 4).every((s) => s.dataset.required === 'true')).toBe(true);
    expect(all.slice(4).every((s) => s.dataset.required === 'false')).toBe(true);
    expect(screen.getAllByTestId('required-mark')).toHaveLength(4);
  });

  it('has no visible text field: a visually hidden, focusable input takes the typing', () => {
    render(<Harness />);
    const input = pinInput();
    expect(input.className).toContain('sr-only');
    expect(input.disabled).toBe(false);
    expect(document.activeElement).toBe(input);
    // The circles are decoration for assistive tech; the input is the one real control.
    expect(document.querySelector('[data-slot]')?.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('fills the circles as characters are typed and drops them on Backspace', () => {
    render(<Harness />);
    fireEvent.change(pinInput(), { target: { value: 'k3#' } });
    expect(slots().filter((s) => s.dataset.filled === 'true')).toHaveLength(3);
    fireEvent.change(pinInput(), { target: { value: 'k3' } });
    expect(slots().filter((s) => s.dataset.filled === 'true')).toHaveLength(2);
  });

  it('accepts a pasted PIN, trimmed to eight characters', () => {
    render(<Harness />);
    fireEvent.change(pinInput(), { target: { value: 'abcdefghijkl' } });
    expect(pinInput().value).toBe('abcdefgh');
    expect(slots().every((s) => s.dataset.filled === 'true')).toBe(true);
  });

  it('shows dots by default and the characters when revealed, then dots again', () => {
    render(<Harness initial="k3#Zp9" />);
    const filled = () => slots().filter((s) => s.dataset.filled === 'true');
    expect(filled()).toHaveLength(6);
    expect(
      slots()
        .map((s) => s.textContent)
        .join(''),
    ).toBe('');
    expect(pinInput().type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show PIN' }));
    expect(
      slots()
        .map((s) => s.textContent)
        .join(''),
    ).toBe('k3#Zp9');
    expect(pinInput().type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide PIN' }));
    expect(
      slots()
        .map((s) => s.textContent)
        .join(''),
    ).toBe('');
    expect(pinInput().type).toBe('password');
  });

  it('starts hidden again after the screen is left and returned to', () => {
    const first = render(<Harness initial="abcd" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show PIN' }));
    first.unmount();
    render(<Harness initial="abcd" />);
    expect(screen.getByRole('button', { name: 'Show PIN' })).toBeTruthy();
  });

  it('submits on Enter only with at least four characters', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(pinInput(), { target: { value: 'abc' } });
    fireEvent.keyDown(pinInput(), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(pinInput(), { target: { value: 'abcd' } });
    fireEvent.keyDown(pinInput(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('clears with Escape', () => {
    render(<Harness initial="abcd" />);
    fireEvent.keyDown(pinInput(), { key: 'Escape' });
    expect(pinInput().value).toBe('');
  });

  it('refocuses the input when the circles are clicked', () => {
    render(<Harness />);
    screen.getByRole('button', { name: 'elsewhere' }).focus();
    expect(document.activeElement).not.toBe(pinInput());
    fireEvent.pointerDown(document.querySelector('[data-slot="3"]')!);
    expect(document.activeElement).toBe(pinInput());
  });

  it('takes focus back after a stray blur, but leaves focus on another control alone', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 0));
    render(<Harness keepFocus />);
    const input = pinInput();

    // Focus lost to nowhere: reclaimed.
    input.blur();
    await vi.advanceTimersByTimeAsync(5);
    expect(document.activeElement).toBe(input);

    // Focus moved to another control on purpose: respected.
    const other = screen.getByRole('button', { name: 'elsewhere' });
    other.focus();
    await vi.advanceTimersByTimeAsync(5);
    expect(document.activeElement).toBe(other);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('announces progress to screen readers without reading the characters', () => {
    render(<Harness />);
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toMatch(/Enter 4 to 8 characters/);
    fireEvent.change(pinInput(), { target: { value: 'ab' } });
    expect(live.textContent).toBe('2 of 8 characters entered. 2 more needed.');
    fireEvent.change(pinInput(), { target: { value: 'abcde' } });
    expect(live.textContent).toBe('5 of 8 characters entered.');
    expect(live.textContent).not.toContain('abcde');
  });

  it('is described by the live status and exposes the reveal button as a toggle', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Show PIN' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(pinInput().getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.click(button);
    expect(
      within(document.body).getByRole('button', { name: 'Hide PIN' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('disables entry while locked out', () => {
    render(<Harness disabled />);
    expect(pinInput().disabled).toBe(true);
  });
});
