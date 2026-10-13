import { FolderOpen, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isTauri } from '../../lib/tauri';
import { conversationsStore, useActiveSettings } from '../../stores/conversations';
import { Button } from '../ui/button';

async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return window.prompt('Folder path for read-only file access:');
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === 'string' ? selected : null;
}

/**
 * Per-conversation system prompt and tool access. Defaults to plain chat with no tools.
 * Mount it with a `key` per conversation so the prompt text resets when the conversation changes.
 */
export function ChatSettings() {
  const settings = useActiveSettings();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(settings.systemPrompt ?? '');
  const root = useRef<HTMLDivElement>(null);
  const update = conversationsStore.getState().updateSettings;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const saveWhenDone = () => {
    const next = prompt.trim() === '' ? null : prompt;
    if (next !== settings.systemPrompt) void update({ systemPrompt: next });
  };

  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Chat settings"
        aria-expanded={open}
        title="Chat settings"
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal size={14} />
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Chat settings"
          className="absolute bottom-9 left-0 z-20 w-80 rounded-panel border border-border-strong bg-elevated p-3 shadow-xl"
        >
          <label className="block text-xs font-medium text-fg-muted" htmlFor="system-prompt">
            System prompt
          </label>
          <textarea
            id="system-prompt"
            value={prompt}
            rows={4}
            placeholder="Optional instructions for this conversation…"
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={saveWhenDone}
            className="selectable mt-1 w-full resize-none rounded-control border border-border bg-surface p-2 font-mono text-xs outline-none focus:border-border-strong"
          />

          <fieldset className="mt-3">
            <legend className="text-xs font-medium text-fg-muted">File access</legend>
            <label className="mt-1 flex items-start gap-2">
              <input
                type="radio"
                name="tools"
                checked={settings.toolsMode === 'off'}
                onChange={() => void update({ toolsMode: 'off' })}
                className="mt-1"
              />
              <span>
                Off{' '}
                <span className="block text-xs text-fg-subtle">
                  Plain chat. Claude cannot touch your files.
                </span>
              </span>
            </label>
            <label className="mt-1.5 flex items-start gap-2">
              <input
                type="radio"
                name="tools"
                checked={settings.toolsMode === 'readonly'}
                onChange={() => void update({ toolsMode: 'readonly' })}
                className="mt-1"
              />
              <span>
                Read-only{' '}
                <span className="block text-xs text-fg-subtle">
                  Claude may read and search files in one folder. It cannot edit files or run
                  commands.
                </span>
              </span>
            </label>
          </fieldset>

          {settings.toolsMode === 'readonly' && (
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() =>
                  void pickFolder().then((cwd) => {
                    if (cwd) void update({ cwd });
                  })
                }
              >
                <FolderOpen size={12} />
                {settings.cwd ? 'Change folder' : 'Choose folder'}
              </Button>
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs text-fg-subtle"
                title={settings.cwd ?? undefined}
              >
                {settings.cwd ?? 'No folder chosen: replies will fail until you pick one.'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
