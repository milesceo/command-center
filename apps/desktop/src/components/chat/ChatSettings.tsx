import { FolderOpen, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { extractVariables } from '../../lib/prompt-vars';
import { resolveSystemPrompt } from '../../lib/system-prompt';
import { isTauri } from '../../lib/tauri';
import {
  conversationsStore,
  useActiveSettings,
  useConversations,
} from '../../stores/conversations';
import { useProjects } from '../../stores/projects';
import { usePrompts } from '../../stores/prompts';
import { VariablesForm } from '../prompts/VariablesForm';
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
  const [askingVars, setAskingVars] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const activeId = useConversations((s) => s.activeId);
  const prompts = usePrompts((s) => s.prompts);
  const projects = useProjects((s) => s.projects);
  const systemPrompts = prompts.filter((p) => p.kind === 'system');
  const project = projects.find((p) => p.id === settings.projectId) ?? null;
  const attached = systemPrompts.find((p) => p.id === settings.systemPromptId) ?? null;
  const effective = resolveSystemPrompt(settings, project, prompts);
  const update = conversationsStore.getState().updateSettings;

  useEffect(() => {
    if (!open) return;
    if (askingVars) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, askingVars]);

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
          <label className="block text-xs font-medium text-fg-muted" htmlFor="chat-project">
            Project
          </label>
          <select
            id="chat-project"
            value={settings.projectId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              if (activeId) void conversationsStore.getState().moveToProject(activeId, id);
              else void update({ projectId: id });
            }}
            className="mt-1 mb-3 w-full rounded-control border border-border bg-surface p-1.5 text-xs outline-none focus:border-border-strong"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <label className="block text-xs font-medium text-fg-muted" htmlFor="system-prompt-lib">
            Library system prompt
          </label>
          <div className="mt-1 flex items-center gap-2">
            <select
              id="system-prompt-lib"
              value={settings.systemPromptId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                const picked = systemPrompts.find((p) => p.id === id);
                void update({ systemPromptId: id, systemPromptVars: {} });
                if (picked && extractVariables(picked.body).length > 0) setAskingVars(true);
              }}
              className="min-w-0 flex-1 rounded-control border border-border bg-surface p-1.5 text-xs outline-none focus:border-border-strong"
            >
              <option value="">
                {project?.defaultSystemPromptId ? 'Project default' : 'None'}
              </option>
              {systemPrompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            {attached && extractVariables(attached.body).length > 0 && (
              <Button size="sm" onClick={() => setAskingVars(true)}>
                Variables
              </Button>
            )}
          </div>
          <p className="mt-1 mb-3 text-[11px] text-fg-subtle" data-testid="system-prompt-source">
            {effective.source === 'conversation' && 'In effect: the text below.'}
            {effective.source === 'library' && `In effect: “${effective.title}” from the library.`}
            {effective.source === 'project' &&
              `In effect: “${effective.title}”, the project default.`}
            {effective.source === 'none' && 'No system prompt in effect.'}
          </p>

          <label className="block text-xs font-medium text-fg-muted" htmlFor="system-prompt">
            Custom system prompt (overrides the above)
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
      {askingVars && attached && (
        <VariablesForm
          title={`Variables for “${attached.title}”`}
          body={attached.body}
          variables={extractVariables(attached.body)}
          initial={settings.systemPromptVars}
          confirmLabel="Save"
          onCancel={() => setAskingVars(false)}
          onSubmit={(values) => {
            void update({ systemPromptVars: values });
            setAskingVars(false);
          }}
        />
      )}
    </div>
  );
}
