import { useEffect } from 'react';
import { ShortcutsDialog } from './components/ui/shortcuts-dialog';
import { Toaster } from './components/ui/toaster';
import { useShortcuts } from './lib/use-shortcuts';
import { MainPanel } from './components/shell/MainPanel';
import { RightPanel } from './components/shell/RightPanel';
import { CommandPalette } from './components/palette/CommandPalette';
import { Sidebar } from './components/shell/Sidebar';
import { useBridgeStore } from './stores/bridge';
import { chatStore } from './stores/chat';
import { conversationsStore, useConversations } from './stores/conversations';
import { projectsStore } from './stores/projects';
import { promptsStore } from './stores/prompts';
import { usageStore } from './stores/usage';
import { applyDisplaySettings, useSettings } from './stores/settings';
import { applyTheme, useUiStore } from './stores/ui';

export function App() {
  const theme = useUiStore((s) => s.theme);
  const activeId = useConversations((s) => s.activeId);
  const connect = useBridgeStore((s) => s.connect);

  const uiScale = useSettings((s) => s.uiScale);
  const codeFontSize = useSettings((s) => s.codeFontSize);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => applyDisplaySettings(uiScale, codeFontSize), [uiScale, codeFontSize]);
  useShortcuts();

  // Start the sidecar and read the saved conversations (which also runs DB migrations).
  useEffect(() => {
    void connect();
    void conversationsStore.getState().load();
    void promptsStore.getState().load();
    void projectsStore.getState().load();
  }, [connect]);

  // Show the selected conversation's history.
  useEffect(() => {
    void chatStore.getState().loadMessages(activeId);
    if (activeId) void usageStore.getState().refreshConversation(activeId);
  }, [activeId]);

  // Picking or starting a conversation always brings the chat back into view.
  useEffect(() => {
    useUiStore.getState().setView('chat');
  }, [activeId]);

  return (
    <div className="flex h-full bg-bg text-fg">
      <Sidebar />
      <MainPanel />
      <RightPanel />
      <ShortcutsDialog />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
