import { useEffect, useRef, useState } from 'react';
import { angleAt, renderSpin } from '../../lib/ascii3d';
import { resolveAppearance } from '../../lib/apply-appearance';
import { tierFlags } from '../../lib/performance';
import { useOsEnvironment } from '../../lib/use-os-environment';
import { usePrefs } from '../../stores/prefs';
import { isPaused, useVisibility } from '../../stores/visibility';

export const LOGO_WORD = 'GEEKED';
const COLS = 120;
const ROWS = 16;

/**
 * "GEEKED" as a spinning 3D solid in ASCII (see `lib/ascii3d.ts`), drawn into a <pre> in the
 * accent color. The frame rate comes from the performance tier; at Lightest, or with animations
 * off, it draws one still frame. It pauses while the window is hidden or minimized, and the
 * work is one small render per frame written straight to the DOM (no React state per frame).
 */
export function AsciiLogo({ className }: { className?: string }) {
  const tier = usePrefs((s) => s.prefs.performance.tier);
  const prefs = usePrefs((s) => s.prefs);
  const os = useOsEnvironment();
  const windowVisible = useVisibility((s) => s.windowVisible);
  const [documentHidden, setDocumentHidden] = useState(
    typeof document !== 'undefined' && document.hidden,
  );
  const pre = useRef<HTMLPreElement>(null);

  const fps = tierFlags(tier).asciiFps;
  const motion = resolveAppearance(prefs, os).motion;
  const still = fps === 0 || motion === 'off';
  const paused = isPaused(windowVisible, documentHidden);

  useEffect(() => {
    const onChange = () => setDocumentHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  useEffect(() => {
    const el = pre.current;
    if (!el) return;
    const draw = (seconds: number) => {
      el.textContent = renderSpin(LOGO_WORD, angleAt(seconds, still), COLS, ROWS).join('\n');
    };
    draw(0);
    if (still || paused) return;

    // Reduced motion halves the rate rather than stopping: it is still motion, but gentler.
    const rate = Math.max(1, motion === 'reduced' ? Math.ceil(fps / 2) : fps);
    const started = performance.now();
    const timer = setInterval(() => draw((performance.now() - started) / 1000), 1000 / rate);
    return () => clearInterval(timer);
  }, [still, paused, fps, motion]);

  return (
    <pre
      ref={pre}
      aria-hidden="true"
      data-testid="ascii-logo"
      data-fps={still || paused ? 0 : fps}
      // Fixed size plus containment: a new frame repaints this box and nothing around it.
      style={{ width: `${COLS}ch`, height: `${ROWS * 1.15}em`, contain: 'strict' }}
      className={`m-0 overflow-hidden font-mono text-[8px] leading-[1.15] font-bold text-accent select-none ${className ?? ''}`}
    />
  );
}
