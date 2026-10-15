import { AsciiLogo } from '../landing/AsciiLogo';

/**
 * The launch screen: the spinning 3D ASCII logo, centered and large, over the app background.
 * It is shown before the PIN lock while the app and bridge start. `leaving` fades it out (the
 * animation setting turns the fade off through the global motion rules).
 */
export function Splash({ leaving = false }: { leaving?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Geeked is starting"
      data-testid="splash"
      data-leaving={leaving}
      className="fixed inset-0 z-[300] grid place-items-center bg-bg transition-opacity duration-300 data-[leaving=true]:pointer-events-none data-[leaving=true]:opacity-0"
    >
      <div className="flex flex-col items-center gap-4">
        <AsciiLogo size="splash" />
        <p className="font-mono text-[11px] tracking-wide text-fg-subtle">starting…</p>
      </div>
    </div>
  );
}
