import { useEffect, useRef, useState } from 'react';
import { bannerFrame, bannerRows, bannerWidth, fieldFrame } from '../../lib/ascii-field';
import { resolveAppearance } from '../../lib/apply-appearance';
import { tierFlags } from '../../lib/performance';
import { useOsEnvironment } from '../../lib/use-os-environment';
import { usePrefs } from '../../stores/prefs';
import { isPaused, useVisibility } from '../../stores/visibility';
import { useEffectiveTier } from '../../stores/power';

/** Below this many columns the wordmark is drawn at one column per pixel; above, doubled. */
const WIDE = 130;
/**
 * Wordmark and pixel scale, largest first: the first that fits the window is drawn. Word and
 * scale are chosen together so the full name is not replaced by the short one just because a
 * doubled full name would be too wide.
 */
const CANDIDATES = [
  ['COMMAND CENTER', 2],
  ['COMMAND CENTER', 1],
  ['COMMAND', 1],
] as const;

/**
 * Full-window animated ASCII: a drifting field with the wordmark lit across the middle.
 * Drawn into two <pre> elements by writing text, not React state, so it never re-renders.
 * With reduced motion it paints one still frame.
 */
export function AsciiBackdrop() {
  const prefs = usePrefs((s) => s.prefs);
  const os = useOsEnvironment();
  const windowVisible = useVisibility((s) => s.windowVisible);
  // The tier sets the frame rate; 0 (Lightest) or animations off draws one still frame.
  const tier = useEffectiveTier();
  const fps = tierFlags(tier).asciiFps;
  const motion = resolveAppearance(prefs, os, tier).motion;
  const still = fps === 0 || motion === 'off';
  // Paused while minimized, hidden to the tray or covered (WebKit reports an occluded window as
  // hidden); re-evaluated on every visibility change, not only when this renders.
  const [documentHidden, setDocumentHidden] = useState(
    typeof document !== 'undefined' && document.hidden,
  );
  useEffect(() => {
    const onChange = () => setDocumentHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  const hidden = isPaused(windowVisible, documentHidden);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLPreElement>(null);
  const banner = useRef<HTMLPreElement>(null);
  const probe = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    const fieldEl = field.current;
    const bannerEl = banner.current;
    const probeEl = probe.current;
    if (!el || !fieldEl || !bannerEl || !probeEl) return;

    let cols = 80;
    let rows = 24;
    let bannerLines = bannerRows(CANDIDATES[1][0], 1);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;

    const measure = () => {
      const cell = probeEl.getBoundingClientRect();
      const w = cell.width / 10 || 8;
      const h = cell.height || 16;
      cols = Math.max(20, Math.ceil(el.clientWidth / w));
      rows = Math.max(8, Math.ceil(el.clientHeight / h));
      const pick = CANDIDATES.find(
        ([word, scale]) => (scale === 1 || cols >= WIDE) && bannerWidth(word, scale) < cols - 4,
      );
      bannerLines = pick ? bannerRows(pick[0], pick[1]) : [];
    };

    const draw = (seconds: number) => {
      fieldEl.textContent = fieldFrame(cols, rows, seconds);
      bannerEl.textContent = bannerLines.length > 0 ? bannerFrame(bannerLines, seconds) : '';
    };

    // Reduced motion halves the rate, as the splash logo does.
    const delay = 1000 / Math.max(1, motion === 'reduced' ? Math.ceil(fps / 2) : fps);
    // A timer at the tier's frame rate, not a requestAnimationFrame loop: that would wake the
    // webview 60 times a second just to skip most frames (measured: ~16% of a core idle).
    const tick = () => {
      last = performance.now();
      draw(last / 1000);
      timer = setTimeout(tick, delay);
    };

    measure();
    // Resume where the animation is now (a still frame uses a fixed time), so it never flashes.
    draw(still ? 2 : performance.now() / 1000);
    const observer = new ResizeObserver(() => {
      measure();
      draw(last / 1000 || 2);
    });
    observer.observe(el);
    if (!still && !hidden) timer = setTimeout(tick, delay);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [fps, still, hidden, motion]);

  return (
    <div ref={box} aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <span
        ref={probe}
        className="invisible absolute font-mono text-[12px] leading-[14px]"
        style={{ whiteSpace: 'pre' }}
      >
        MMMMMMMMMM
      </span>
      <pre
        ref={field}
        className="absolute inset-0 m-0 font-mono text-[12px] leading-[14px] text-fg-subtle/35 select-none"
      />
      <pre
        ref={banner}
        className="absolute top-[22%] left-1/2 m-0 -translate-x-1/2 font-mono text-[12px] leading-[14px] font-bold text-accent select-none"
        style={{ textShadow: '0 0 12px var(--accent)' }}
      />
    </div>
  );
}
