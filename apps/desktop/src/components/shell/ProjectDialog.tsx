import { useMemo, useState } from 'react';
import { extractVariables } from '../../lib/prompt-vars';
import type { Project } from '../../lib/types';
import { projectsStore } from '../../stores/projects';
import { usePrompts } from '../../stores/prompts';
import { Button } from '../ui/button';
import { Modal } from '../ui/dialog';

/** Rename a project and choose its default system prompt (with values for the prompt's variables). */
export function ProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const allPrompts = usePrompts((s) => s.prompts);
  const systemPrompts = useMemo(() => allPrompts.filter((p) => p.kind === 'system'), [allPrompts]);
  const [name, setName] = useState(project.name);
  const [promptId, setPromptId] = useState<string | null>(project.defaultSystemPromptId);
  const [values, setValues] = useState<Record<string, string>>(project.defaultSystemPromptVars);
  const chosen = systemPrompts.find((p) => p.id === promptId);
  const variables = chosen ? extractVariables(chosen.body) : [];

  const save = async () => {
    const store = projectsStore.getState();
    await store.rename(project.id, name);
    await store.setSystemPrompt(
      project.id,
      promptId,
      promptId ? Object.fromEntries(variables.map((v) => [v, values[v] ?? ''])) : {},
    );
    onClose();
  };

  return (
    <Modal title={`Project: ${project.name}`} onClose={onClose}>
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-fg-muted">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-control border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-border-strong"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-medium text-fg-muted">Default system prompt</span>
            <select
              value={promptId ?? ''}
              onChange={(e) => setPromptId(e.target.value || null)}
              className="rounded-control border border-border bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-border-strong"
            >
              <option value="">None</option>
              {systemPrompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-fg-subtle">
              Used by every chat in this project that has no system prompt of its own.
            </span>
          </label>

          {variables.map((v) => (
            <label key={v} className="flex flex-col gap-1">
              <span className="font-medium text-fg-muted">{v}</span>
              <input
                value={values[v] ?? ''}
                onChange={(e) => setValues((cur) => ({ ...cur, [v]: e.target.value }))}
                className="rounded-control border border-border bg-surface px-2 py-1.5 font-mono text-[13px] outline-none focus:border-border-strong"
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={name.trim() === ''}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
