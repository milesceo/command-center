import { useEffect, useRef } from 'react';
import { bannerFrame, bannerRows, bannerWidth, fieldFrame } from '../../lib/ascii-field';

const WORD = 'GEEKED';
const FPS = 24;
/** Below this many columns the wordmark is drawn at one column per pixel; above, doubled. */
const WIDE = 130;

/**
 * Full-window animated ASCII: a drifting field with the wordmark lit across the middle.
 * Drawn into two <pre> elements by writing text, not React state, so it never re-renders.
 * With reduced motion it paints one still frame.
 */
export function AsciiBackdrop() {
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

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 80;
    let rows = 24;
    let bannerLines = bannerRows(WORD, 1);
    let raf = 0;
    let last = 0;

    const measure = () => {
      const cell = probeEl.getBoundingClientRect();
      const w = cell.width / 10 || 8;
      const h = cell.height || 16;
      cols = Math.max(20, Math.ceil(el.clientWidth / w));
      rows = Math.max(8, Math.ceil(el.clientHeight / h));
      const scale = cols >= WIDE ? 2 : 1;
      bannerLines = bannerWidth(WORD, scale) < cols - 4 ? bannerRows(WORD, scale) : [];
    };

    const draw = (seconds: number) => {
      fieldEl.textContent = fieldFrame(cols, rows, seconds);
      bannerEl.textContent = bannerLines.length > 0 ? bannerFrame(bannerLines, seconds) : '';
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS) return;
      last = now;
      draw(now / 1000);
    };

    measure();
    draw(2);
    const observer = new ResizeObserver(() => {
      measure();
      draw(last / 1000 || 2);
    });
    observer.observe(el);
    if (!reduced) raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

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
