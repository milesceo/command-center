import { useEffect } from 'react';
import { extractCodeBlocks } from './code-blocks';
import { copyText } from './clipboard';
import { isMacPlatform, matchShortcut, type ShortcutId } from './shortcuts';
import { chatStore } from '../stores/chat';
import { conversationsStore } from '../stores/conversations';
import { previewStore } from '../stores/preview';
import { toast } from '../stores/toast';
import { useUiStore } from '../stores/ui';

/** The code block a "copy last code block" shortcut should take: newest in the live reply, else in the last reply. */
export function lastCodeBlock(): string | null {
  const { activeId } = conversationsStore.getState();
  const { streams, messages } = chatStore.getState();
  const live = activeId ? streams[activeId]?.text : undefined;
  const lastReply = [...messages].reverse().find((m) => m.role === 'assistant')?.content;
  for (const text of [live, lastReply]) {
    const block = text ? extractCodeBlocks(text).at(-1) : undefined;
    if (block) return block.code;
  }
  return null;
}

async function run(id: ShortcutId) {
  const ui = useUiStore.getState();
  switch (id) {
    case 'commandPalette':
      ui.setPaletteOpen(!ui.paletteOpen);
      return;
    case 'copyLastCode': {
      const code = lastCodeBlock();
      if (code === null) toast('No code block to copy');
      else toast((await copyText(code)) ? 'Copied last code block' : 'Could not copy');
      return;
    }
    case 'togglePreview':
      ui.toggleRightPanel();
      return;
    case 'toggleDiffMode':
      ui.toggleDiffMode();
      toast(`Diffs: ${useUiStore.getState().diffMode === 'split' ? 'side by side' : 'inline'}`);
      return;
    case 'toggleSidebar':
      ui.toggleSidebar();
      return;
    case 'showShortcuts':
      ui.setShortcutsOpen(!ui.shortcutsOpen);
      return;
  }
}

/** Installs the global keyboard shortcuts (and Escape to cancel a pending code comparison). */
export function useShortcuts(): void {
  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewStore.getState().compare) {
        previewStore.getState().cancelCompare();
        return;
      }
      const id = matchShortcut(e, mac);
      if (!id) return;
      e.preventDefault();
      void run(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
