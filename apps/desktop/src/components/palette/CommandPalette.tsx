import { MODEL_OPTIONS } from '@geeked/protocol';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { filterCommands, type Command } from '../../lib/commands';
import { getDb } from '../../lib/db';
import * as repo from '../../lib/repo';
import { formatKeys, isMacPlatform } from '../../lib/shortcuts';
import { useFocusTrap } from '../../lib/use-focus-trap';
import type { Conversation } from '../../lib/types';
import { cn } from '../../lib/cn';
import { conversationsStore } from '../../stores/conversations';
import { useComposerStore } from '../../stores/composer';
import { useIdeStore } from '../../stores/ide';
import { useLockStore } from '../../stores/lock';
import { useQa } from '../../stores/qa';
import { usePrompts } from '../../stores/prompts';
import { toast } from '../../stores/toast';
import { useUiStore, type View } from '../../stores/ui';
import { usePromptActions } from '../prompts/usePromptActions';

const RECENT_CONVERSATIONS = 30;

function useCommands(conversations: Conversation[]): {
  commands: Command[];
  dialog: React.ReactNode;
} {
  const prompts = usePrompts((s) => s.prompts);
  const actions = usePromptActions();

  const commands = useMemo(() => {
    const ui = useUiStore.getState;
    const goto = (view: View) => () => ui().setView(view);
    const list: Command[] = [
      {
        id: 'new-chat',
        title: 'New chat',
        group: 'Actions',
        run: () => {
          conversationsStore.getState().newChat();
          ui().setView('chat');
        },
      },
      {
        id: 'open-settings',
        title: 'Open settings',
        group: 'Actions',
        keywords: 'preferences options',
        run: goto('settings'),
      },
      {
        id: 'open-usage',
        title: 'Open usage',
        group: 'Actions',
        keywords: 'tokens cost limits',
        run: goto('usage'),
      },
      {
        id: 'open-prompts',
        title: 'Open prompt library',
        group: 'Actions',
        keywords: 'prompts snippets',
        run: goto('prompts'),
      },
      { id: 'open-chat', title: 'Back to chat', group: 'Actions', run: goto('chat') },
      {
        id: 'lock',
        title: 'Lock Geeked',
        group: 'Actions',
        shortcut: 'Mod+L',
        keywords: 'pin screen lock',
        run: () => {
          const lock = useLockStore.getState();
          if (lock.hasPin) lock.lock();
          else {
            toast('Set a PIN in Settings to use the lock');
            ui().setView('settings');
          }
        },
      },
      {
        id: 'qa-panel',
        title: 'Show QA checklist',
        group: 'Actions',
        shortcut: 'Mod+Shift+Q',
        keywords: 'test testing checklist manual qa',
        run: () => {
          const qa = useQa.getState();
          if (!qa.enabled) {
            toast('Turn on the QA checklist in Settings > About first');
            return;
          }
          qa.setOpen(true);
        },
      },
      {
        id: 'toggle-assistant',
        title: 'Toggle assistant panel',
        group: 'Actions',
        shortcut: 'Mod+Shift+A',
        run: () => useIdeStore.getState().toggleAssistant(),
      },
      {
        id: 'toggle-activity',
        title: 'Toggle activity panel',
        group: 'Actions',
        shortcut: 'Mod+J',
        keywords: 'usage tokens replies',
        run: () => useIdeStore.getState().toggleBottom(),
      },
      {
        id: 'layout',
        title: ui().layout === 'ide' ? 'Use classic layout' : 'Use editor layout',
        group: 'Actions',
        keywords: 'ide sidebar columns',
        run: () => ui().setLayout(ui().layout === 'ide' ? 'classic' : 'ide'),
      },
      {
        id: 'toggle-sidebar',
        title: 'Toggle sidebar',
        group: 'Actions',
        shortcut: 'Mod+B',
        run: () => ui().toggleSidebar(),
      },
      {
        id: 'toggle-preview',
        title: 'Toggle preview panel',
        group: 'Actions',
        shortcut: 'Mod+Shift+P',
        run: () => ui().toggleRightPanel(),
      },
      {
        id: 'toggle-theme',
        title: 'Toggle light/dark theme',
        group: 'Actions',
        keywords: 'dark light mode',
        run: () => ui().toggleTheme(),
      },
      {
        id: 'toggle-diff',
        title: 'Toggle diff layout',
        group: 'Actions',
        shortcut: 'Mod+Shift+D',
        keywords: 'side by side inline',
        run: () => ui().toggleDiffMode(),
      },
      {
        id: 'shortcuts',
        title: 'Show keyboard shortcuts',
        group: 'Actions',
        shortcut: 'Mod+/',
        run: () => ui().setShortcutsOpen(true),
      },
      ...MODEL_OPTIONS.map<Command>((m) => ({
        id: `model-${m.id}`,
        title: `Change model: ${m.label}`,
        group: 'Model',
        keywords: 'switch',
        run: () => {
          ui().setView('chat');
          void conversationsStore
            .getState()
            .updateSettings({ model: m.id === 'default' ? null : m.id });
        },
      })),
      ...conversations.map<Command>((c) => ({
        id: `chat-${c.id}`,
        title: c.title,
        group: 'Conversations',
        keywords: 'switch open chat',
        run: () => {
          conversationsStore.getState().select(c.id);
          ui().setView('chat');
        },
      })),
      ...prompts.map<Command>((p) =>
        p.kind === 'prompt'
          ? {
              id: `prompt-${p.id}`,
              title: `Insert prompt: ${p.title}`,
              group: 'Prompts',
              keywords: p.tags.join(' '),
              run: () =>
                actions.requestText(p, (text) => {
                  ui().setView('chat');
                  useComposerStore.getState().insert(text);
                }),
            }
          : {
              id: `system-${p.id}`,
              title: `Use system prompt: ${p.title}`,
              group: 'Prompts',
              keywords: p.tags.join(' '),
              run: () => {
                ui().setView('chat');
                actions.attachSystemPrompt(p);
              },
            },
      ),
    ];
    return list;
    // `actions` is rebuilt every render but only closes over setState, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, prompts]);

  return { commands, dialog: actions.dialog };
}

/** Ctrl/Cmd+K: one search box for every action, conversation and saved prompt. */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // Read the full list when the palette opens: the sidebar's own list may be filtered by its search box.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void getDb()
      .then((db) => repo.listConversations(db))
      .then((all) => alive && setConversations(all.slice(0, RECENT_CONVERSATIONS)))
      .catch(() => alive && setConversations(conversationsStore.getState().conversations));
    return () => {
      alive = false;
    };
  }, [open]);

  const { commands, dialog } = useCommands(conversations);
  return (
    <>
      {open && <PaletteSurface commands={commands} />}
      {/* Outside the open check: the variables form must outlive the palette that launched it. */}
      {dialog}
    </>
  );
}

function PaletteSurface({ commands }: { commands: Command[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useFocusTrap(panel);
  const mac = isMacPlatform();

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const active = Math.min(selected, Math.max(0, results.length - 1));

  const close = () => useUiStore.getState().setPaletteOpen(false);
  const choose = (command: Command | undefined) => {
    if (!command) return;
    close();
    // After the palette has unmounted, so focus returns before the command moves it elsewhere.
    queueMicrotask(command.run);
  };

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, results]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setSelected((active + step + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setSelected(e.key === 'Home' ? 0 : results.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-panel border border-border-strong bg-elevated shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={14} className="shrink-0 text-fg-subtle" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            aria-label="Search commands, conversations and prompts"
            placeholder="Type a command, conversation or prompt…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            className="h-11 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
          />
        </div>
        <ul
          id="palette-list"
          ref={list}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {results.length === 0 && (
            <li role="presentation" className="px-3 py-6 text-center text-xs text-fg-subtle">
              Nothing matches “{query}”.
            </li>
          )}
          {results.map((c, i) => {
            const heading = c.group !== results[i - 1]?.group;
            return (
              <li key={c.id} role="presentation">
                {heading && query.trim() === '' && (
                  <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
                    {c.group}
                  </p>
                )}
                <div
                  id={`palette-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => choose(c)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-control px-2.5 py-1.5 text-[13px]',
                    i === active ? 'bg-hover text-fg' : 'text-fg-muted',
                  )}
                >
                  <span className="min-w-0 truncate">{c.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] text-fg-subtle">
                    {query.trim() !== '' && <span>{c.group}</span>}
                    {c.shortcut && (
                      <kbd className="font-mono">{formatKeys(c.shortcut, mac).join(' ')}</kbd>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-border px-3 py-1.5 text-[11px] text-fg-subtle">
          ↑↓ to move, Enter to run, Esc to close
        </p>
      </div>
    </div>
  );
}
