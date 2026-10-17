import { useEffect, useState } from 'react';
import { system } from '../../lib/system';
import type { CloseBehavior } from '../../lib/prefs';
import { usePrefs } from '../../stores/prefs';
import { toast } from '../../stores/toast';
import { Row } from '../settings/parts';
import { Segmented } from '../ui/segmented';
import { Switch } from '../ui/switch';
import { platformCopy } from '../../lib/platform-copy';

/** Start at login, and what the close button does (with the tray menu it enables). */
export function SystemControls() {
  const autostart = usePrefs((s) => s.prefs.system.autostart);
  const closeBehavior = usePrefs((s) => s.prefs.system.closeBehavior);
  const setAutostart = usePrefs((s) => s.setAutostart);
  const setCloseBehavior = usePrefs((s) => s.setCloseBehavior);
  const [busy, setBusy] = useState(false);
  const desktop = system.available();

  // The registration can be changed outside the app (Task Manager's Startup tab); trust it.
  useEffect(() => {
    if (!desktop) return;
    void system
      .isAutostartEnabled()
      .then((actual) => {
        if (actual !== usePrefs.getState().prefs.system.autostart) {
          usePrefs.getState().setAutostart(actual);
        }
      })
      .catch(() => undefined);
  }, [desktop]);

  const changeAutostart = async (enabled: boolean) => {
    setBusy(true);
    try {
      setAutostart(await system.setAutostart(enabled));
    } catch (err) {
      toast(`Could not change startup: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const changeClose = (behavior: CloseBehavior) => {
    setCloseBehavior(behavior);
    void system.setCloseBehavior(behavior).catch((err: unknown) => {
      toast(`Could not change close behavior: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="system-controls">
      <Row
        label={platformCopy.startAtLogin()}
        hint={desktop ? 'Off by default.' : 'Available in the desktop app.'}
      >
        <Switch
          label={platformCopy.startAtLogin()}
          checked={autostart}
          disabled={!desktop || busy}
          onChange={(v) => void changeAutostart(v)}
        />
      </Row>

      <Row
        label="When I close the window"
        hint={
          closeBehavior === 'tray'
            ? `Command Center keeps running in the ${platformCopy.tray()} (Open, New chat, Lock, Quit). The app locks when it hides.`
            : 'Command Center quits.'
        }
      >
        <Segmented<CloseBehavior>
          label="When I close the window"
          value={closeBehavior}
          options={[
            { value: 'tray', label: `Minimize to ${platformCopy.tray()}` },
            { value: 'quit', label: 'Quit' },
          ]}
          onChange={changeClose}
        />
      </Row>
    </div>
  );
}
