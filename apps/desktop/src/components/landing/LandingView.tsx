import { useEffect, useState } from 'react';
import { getDb } from '../../lib/db';
import { pickForLaunch, type PickedMessage } from '../../lib/launch-messages';
import { launchStats } from '../../lib/repo-stats';
import { usePrefs } from '../../stores/prefs';
import { AsciiLogo } from './AsciiLogo';
import { CommandCenterMark } from './CommandCenterMark';

/**
 * The message is chosen once per launch (not per visit to this screen), so returning to Home
 * shows the same line until the app is restarted.
 */
let launchMessage: PickedMessage | null = null;

/** Test hook: forget the line chosen for this launch. */
export function resetLaunchMessage(): void {
  launchMessage = null;
}

async function choose(name: string): Promise<PickedMessage> {
  let stats = {};
  try {
    stats = await launchStats(await getDb());
  } catch {
    // No database (plain browser): greetings and quips only.
  }
  return pickForLaunch({ name, now: new Date(), stats });
}

/** Home: a still ASCII logo top left, and the Command Center mark with a rotating line at the center. */
export function LandingView() {
  const name = usePrefs((s) => s.prefs.profile.name);
  const [message, setMessage] = useState<PickedMessage | null>(launchMessage);

  useEffect(() => {
    if (launchMessage) return;
    let cancelled = false;
    void choose(name).then((picked) => {
      launchMessage = picked;
      if (!cancelled) setMessage(picked);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ containerType: 'inline-size' }}
      data-testid="landing-view"
    >
      {/* Static here on purpose: the spinning logo belongs to the splash screen. */}
      <AsciiLogo size="corner" still className="absolute top-4 left-5" />

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <CommandCenterMark size={76} />
        <h1 className="font-mono text-2xl font-semibold tracking-tight">command center</h1>
        <p
          key={message?.id ?? 'pending'}
          role="status"
          data-testid="launch-message"
          className="landing-message min-h-[1.75rem] max-w-xl text-[15px] text-fg-muted"
        >
          {message?.text ?? ''}
        </p>
      </div>
    </div>
  );
}
