import { useEffect, useRef, useState } from 'react';
import { angleAt, renderSpin } from '../../lib/ascii3d';
import { resolveAppearance } from '../../lib/apply-appearance';
import { tierFlags } from '../../lib/performance';
import { useOsEnvironment } from '../../lib/use-os-environment';
import { usePrefs } from '../../stores/prefs';
import { isPaused, useVisibility } from '../../stores/visibility';

/**
 * The spinning mark spells the first word only: at the three-quarter still angle the 13-letter name
 * no longer reads, and the full name is set in type beside it on Home.
 */
export const LOGO_WORD = 'COMMAND';
export const LOGO_COLS = 120;
export const LOGO_ROWS = 16;

interface Props {
  className?: string;
  /**
   * `splash` is the large, centered, spinning logo of the launch screen; `corner` is the small
   * one in the Home screen's top-left corner.
   */
  size?: 'splash' | 'corner';
  /** Draw one fixed frame and never animate (the Home corner logo). */
  still?: boolean;
}

/** `splash` scales with the window (120 columns at 0.6em wide); `corner` is a fixed 8 px. */
const FONT_SIZE = {
  splash: 'min(12px, calc((100vw - 48px) / 72))',
  // Scales down inside a narrow pane (the Home view is a size container).
  corner: 'min(8px, calc((100cqw - 40px) / 72))',
} as const;

/**
 * "COMMAND" as a 3D solid in ASCII (see `lib/ascii3d.ts`), drawn into a <pre> in the accent color.
 * It spins only on the splash screen: the frame rate comes from the performance tier, it is one
 * still frame at Lightest or with animations off, and it pauses while the window is hidden or
 * minimized. The still frame is a three-quarter view that reads as COMMAND. Frames are written
 * straight to the DOM, never through React state.
 */
export function AsciiLogo({ className, size = 'splash', still: forceStill = false }: Props) {
  const prefs = usePrefs((s) => s.prefs);
  const os = useOsEnvironment();
  const windowVisible = useVisibility((s) => s.windowVisible);
  const [documentHidden, setDocumentHidden] = useState(
    typeof document !== 'undefined' && document.hidden,
  );
  const pre = useRef<HTMLPreElement>(null);

  const fps = tierFlags(prefs.performance.tier).asciiFps;
  const motion = resolveAppearance(prefs, os).motion;
  const still = forceStill || fps === 0 || motion === 'off';
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
      el.textContent = renderSpin(LOGO_WORD, angleAt(seconds, still), LOGO_COLS, LOGO_ROWS).join(
        '\n',
      );
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
      data-size={size}
      data-fps={still || paused ? 0 : fps}
      // Fixed size plus containment: a new frame repaints this box and nothing around it.
      style={{
        fontSize: FONT_SIZE[size],
        width: `${LOGO_COLS}ch`,
        height: `${LOGO_ROWS * 1.15}em`,
        contain: 'strict',
      }}
      className={`m-0 overflow-hidden font-mono leading-[1.15] font-bold text-accent select-none ${className ?? ''}`}
    />
  );
}
