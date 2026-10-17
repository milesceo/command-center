import { useEffect, useRef } from 'react';
import { ShortcutsDialog } from './components/ui/shortcuts-dialog';
import { Toaster } from './components/ui/toaster';
import { useShortcuts } from './lib/use-shortcuts';
import { MainPanel } from './components/shell/MainPanel';
import { RightPanel } from './components/shell/RightPanel';
import { CommandPalette } from './components/palette/CommandPalette';
import { Sidebar } from './components/shell/Sidebar';
import { LockGate } from './components/lock/LockGate';
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { ClassicTitleBar } from './components/shell/WindowControls';
import { IdeShell } from './ide/IdeShell';
import { system, listenToTray } from './lib/system';
import { useAppearance } from './lib/use-appearance';
import { useBridgeStore } from './stores/bridge';
import { chatStore } from './stores/chat';
import { conversationsStore, useConversations } from './stores/conversations';
import { useLockStore } from './stores/lock';
import { usePrefs } from './stores/prefs';
import { projectsStore } from './stores/projects';
import { promptsStore } from './stores/prompts';
import { usageStore } from './stores/usage';
import { applyDisplaySettings, useSettings } from './stores/settings';
import { useUiStore } from './stores/ui';
import { useStatus } from './stores/status';
import { useVisibility } from './stores/visibility';
import { ModelNotices } from './components/status/ModelNotices';
import { QaPanel } from './qa/QaPanel';

export function App() {
  const layout = useUiStore((s) => s.layout);
  const activeId = useConversations((s) => s.activeId);
  const connect = useBridgeStore((s) => s.connect);
  const onboarded = usePrefs((s) => s.prefs.onboarding.completed);

  const prefs = usePrefs((s) => s.prefs);
  const codeFontSize = useSettings((s) => s.codeFontSize);

  // Theme, palette, accent, animation level, density and glass, resolved against the OS.
  useAppearance();
  useEffect(
    () => applyDisplaySettings(prefs.appearance.fontScale, codeFontSize),
    [prefs.appearance.fontScale, codeFontSize],
  );
  useShortcuts();

  // Tell Rust what closing the window should do (it applies before the webview loads on later
  // launches, but the saved preference is the source of truth), and listen to the tray menu.
  const closeBehavior = prefs.system.closeBehavior;
  useEffect(() => {
    void system.setCloseBehavior(closeBehavior).catch(() => undefined);
  }, [closeBehavior]);

  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void listenToTray({
      onNewChat: () => {
        conversationsStore.getState().newChat();
        useUiStore.getState().setView('chat');
      },
      onLock: () => useLockStore.getState().lock(),
      onVisibility: (visible) => {
        useVisibility.getState().setWindowVisible(visible);
        // Hiding to the tray locks the app, so it is not sitting open behind a hidden window.
        if (!visible) useLockStore.getState().lock();
      },
      onSettings: () => useUiStore.getState().setView('settings'),
    }).then((unlisten) => {
      if (disposed) unlisten();
      else off = unlisten;
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  // The AI status feed: cached copy first, then on launch and every 30 minutes.
  useEffect(() => {
    useStatus.getState().start();
    return () => useStatus.getState().stop();
  }, []);

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

  // Picking or starting a conversation brings the chat back into view; the very first run keeps
  // the launch screen (Home) instead.
  const selectionSeq = useConversations((s) => s.selectionSeq);
  const seenSelection = useRef(selectionSeq);
  useEffect(() => {
    if (seenSelection.current === selectionSeq) return;
    seenSelection.current = selectionSeq;
    useUiStore.getState().setView('chat');
  }, [selectionSeq]);

  return (
    <div className="flex h-full bg-bg text-fg">
      <LockGate>
        {!onboarded ? (
          <OnboardingFlow />
        ) : layout === 'ide' ? (
          <IdeShell />
        ) : (
          <div className="flex h-full min-w-0 flex-1 flex-col">
            <ClassicTitleBar />
            <div className="flex min-h-0 flex-1">
              <Sidebar />
              <MainPanel />
              <RightPanel />
            </div>
          </div>
        )}
        {onboarded && (
          <>
            <ShortcutsDialog />
            <CommandPalette />
            <ModelNotices />
            <QaPanel />
          </>
        )}
      </LockGate>
      <Toaster />
    </div>
  );
}
