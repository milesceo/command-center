// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bannerRows, bannerWidth } from '../../lib/ascii-field';
import { usePrefs } from '../../stores/prefs';
import { AsciiBackdrop } from './AsciiBackdrop';

// jsdom lays nothing out: the probe measures 0 (the component then assumes 8 px per column), so
// the window width in columns is clientWidth / 8. Lightest tier draws one still frame (no rAF).
let width = 0;
let resize: (() => void) | null = null;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      resize = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => usePrefs.getState().setTier('lightest'));
afterEach(() => {
  cleanup();
  resize = null;
});

/** Renders at `cols` columns and returns the banner's shape (lit pixels as '#'). */
function bannerAt(cols: number): string {
  width = cols * 8;
  const { container } = render(<AsciiBackdrop />);
  const banner = container.querySelectorAll('pre')[1];
  return shape(banner?.textContent ?? '');
}

const shape = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/[^ ]/g, '#'))
    .join('\n');
const expected = (word: string, scale: number) => bannerRows(word, scale).join('\n');

describe('AsciiBackdrop wordmark', () => {
  it('draws the full name doubled when there is room for it', () => {
    const cols = bannerWidth('COMMAND CENTER', 2) + 5;
    expect(bannerAt(cols)).toBe(expected('COMMAND CENTER', 2));
  });

  it('keeps the full name at single scale when doubled would not fit, even past WIDE', () => {
    // 150 columns is past the doubling threshold (130) but too narrow for the doubled name (166).
    expect(bannerAt(150)).toBe(expected('COMMAND CENTER', 1));
    expect(bannerAt(130)).toBe(expected('COMMAND CENTER', 1));
  });

  it('switches to the short name only when the full one does not fit at all', () => {
    const full = bannerWidth('COMMAND CENTER', 1);
    expect(bannerAt(full + 5)).toBe(expected('COMMAND CENTER', 1));
    cleanup();
    expect(bannerAt(full + 4)).toBe(expected('COMMAND', 1));
  });

  it('draws no banner when even the short name does not fit', () => {
    expect(bannerAt(bannerWidth('COMMAND', 1) + 5)).toBe(expected('COMMAND', 1));
    cleanup();
    expect(bannerAt(bannerWidth('COMMAND', 1) + 4)).toBe('');
    cleanup();
    expect(bannerAt(1)).toBe('');
  });

  it('re-picks the wordmark on resize', () => {
    const { container } = render(<AsciiBackdrop />, {});
    const banner = () => shape(container.querySelectorAll('pre')[1]?.textContent ?? '');
    for (const [cols, word, scale] of [
      [200, 'COMMAND CENTER', 2],
      [60, 'COMMAND', 1],
      [100, 'COMMAND CENTER', 1],
      [30, '', 0],
    ] as const) {
      width = cols * 8;
      act(() => resize?.());
      expect(banner()).toBe(word ? expected(word, scale) : '');
    }
  });

  it('never draws a banner wider than the window', () => {
    for (let cols = 20; cols <= 260; cols += 3) {
      const lines = bannerAt(cols).split('\n');
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThan(cols);
      cleanup();
    }
  });
});
