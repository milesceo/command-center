import { useEffect } from 'react';
import { MainPanel } from './components/shell/MainPanel';
import { RightPanel } from './components/shell/RightPanel';
import { Sidebar } from './components/shell/Sidebar';
import { openDatabase } from './lib/db';
import { useBridgeStore } from './stores/bridge';
import { applyTheme, useUiStore } from './stores/ui';

export function App() {
  const theme = useUiStore((s) => s.theme);
  const connect = useBridgeStore((s) => s.connect);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    void connect();
    // Opening the DB runs migrations; surface failures in the console for now.
    openDatabase().catch((err: unknown) => console.error('[db] failed to open', err));
  }, [connect]);

  return (
    <div className="flex h-full bg-bg text-fg">
      <Sidebar />
      <MainPanel />
      <RightPanel />
    </div>
  );
}
