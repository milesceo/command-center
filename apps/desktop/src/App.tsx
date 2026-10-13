import { useEffect } from 'react';
import { MainPanel } from './components/shell/MainPanel';
import { RightPanel } from './components/shell/RightPanel';
import { Sidebar } from './components/shell/Sidebar';
import { useBridgeStore } from './stores/bridge';
import { chatStore } from './stores/chat';
import { conversationsStore, useConversations } from './stores/conversations';
import { applyTheme, useUiStore } from './stores/ui';

export function App() {
  const theme = useUiStore((s) => s.theme);
  const activeId = useConversations((s) => s.activeId);
  const connect = useBridgeStore((s) => s.connect);

  useEffect(() => applyTheme(theme), [theme]);

  // Start the sidecar and read the saved conversations (which also runs DB migrations).
  useEffect(() => {
    void connect();
    void conversationsStore.getState().load();
  }, [connect]);

  // Show the selected conversation's history.
  useEffect(() => {
    void chatStore.getState().loadMessages(activeId);
  }, [activeId]);

  return (
    <div className="flex h-full bg-bg text-fg">
      <Sidebar />
      <MainPanel />
      <RightPanel />
    </div>
  );
}
