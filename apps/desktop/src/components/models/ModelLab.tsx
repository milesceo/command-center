import { Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getBridgeClient } from '../../lib/bridge-client';
import { platformCopy } from '../../lib/platform-copy';
import { isMacPlatform } from '../../lib/shortcuts';
import { previewCommand, runRequest, storedSource } from '../../lib/model-draft';
import type { CustomModel } from '../../lib/repo-models';
import { getDb } from '../../lib/db';
import { conversationIdsWithModel } from '../../lib/repo';
import { ensureBridge } from '../../stores/bridge';
import { chatStore } from '../../stores/chat';
import { conversationsStore } from '../../stores/conversations';
import { customModelRef, useCustomModels } from '../../stores/custom-models';
import { useProviders } from '../../stores/providers';
import { toast } from '../../stores/toast';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';
import { CopyButton } from '../ui/copy-button';
import { ConfirmDialog } from '../ui/dialog';
import { ListSkeleton } from '../ui/skeleton';
import { AddModelDialog } from './AddModelDialog';
import { ModelCard } from './ModelCard';
import { ModelSettingsForm } from './ModelSettingsForm';
import { ModelTestPanel } from './ModelTestPanel';
import { startChatWith } from './start-chat';

/** At most this many models answer one test prompt at once (an 8 GB Mac runs one or two). */
export const MAX_TEST_MODELS = 4;

/**
 * The Model Lab: models the user added from Hugging Face or from files on this computer, with
 * their settings, a way to start local ones, and a side-by-side test.
 */
export function ModelLab() {
  const models = useCustomModels((s) => s.models);
  const loaded = useCustomModels((s) => s.loaded);
  const loadError = useCustomModels((s) => s.error);
  const runtimes = useProviders((s) => s.infos.local?.runtimes);
  const checking = useProviders((s) => s.loading);
  const openAdd = useUiStore((s) => s.addModelOpen);
  const [editing, setEditing] = useState<CustomModel | null>(null);
  const [removing, setRemoving] = useState<CustomModel | null>(null);
  // The model whose chats are about to be deleted, with their ids (counted when asked).
  const [clearing, setClearing] = useState<{ model: CustomModel; ids: string[] } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [running, setRunning] = useState<CustomModel | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!loaded) void useCustomModels.getState().load();
  }, [loaded]);

  const chosen = useMemo(() => models.filter((m) => picked.includes(m.id)), [models, picked]);

  const toggle = (id: string) => {
    if (!picked.includes(id) && picked.length >= MAX_TEST_MODELS) {
      toast(`Compare up to ${MAX_TEST_MODELS} models at once`);
      return;
    }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const serving = (m: CustomModel): boolean | null => {
    if (m.provider !== 'local' || !runtimes) return null;
    const status = runtimes.find((r) => r.id === m.runtime);
    if (!status) return null;
    if (!status.running) return false;
    // llama-server serves one model under whatever name it was started with; Ollama adds
    // `:latest` to a name without a tag.
    if (m.runtime === 'llama.cpp') return status.models.length > 0;
    return status.models.some((name) => name === m.model || name === `${m.model}:latest`);
  };

  const commandFor = (m: CustomModel): string | null => {
    const source = storedSource(m);
    return source && m.runtime
      ? previewCommand(runRequest(m.runtime, source, m.adapterPath))
      : null;
  };

  const run = async (m: CustomModel) => {
    const source = storedSource(m);
    if (!source || !m.runtime || starting) return;
    setStarting(true);
    try {
      await ensureBridge();
      const report = await getBridgeClient().localRun(runRequest(m.runtime, source, m.adapterPath));
      const local = report.find((p) => p.id === 'local');
      if (local) useProviders.setState((s) => ({ infos: { ...s.infos, local } }));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
      setRunning(null);
    }
  };

  const askToClear = async (m: CustomModel) => {
    try {
      const ids = await conversationIdsWithModel(await getDb(), customModelRef(m.id));
      if (ids.length === 0) toast(`No chats with ${m.displayName}`);
      else setClearing({ model: m, ids });
    } catch (err) {
      toast(`Could not read the chats: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const setAddOpen = (open: boolean) => useUiStore.getState().setAddModelOpen(open);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="model-lab">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Model Lab</h1>
            <p className="text-[11px] text-fg-subtle">
              Models from Hugging Face, in the cloud or on {platformCopy.thisComputer()}, and model
              files you already have. Command Center never downloads or runs weights itself: your
              runtime does.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void useProviders.getState().refresh()}
              disabled={checking}
              title="Check which runtimes are running"
            >
              <RefreshCw size={12} />
              {checking ? 'Checking…' : 'Check runtimes'}
            </Button>
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
              <Plus size={12} />
              Add a model
            </Button>
          </div>
        </header>

        {!loaded ? (
          <ListSkeleton rows={3} />
        ) : loadError ? (
          <div role="alert" className="flex items-center gap-2">
            <p className="text-danger">Could not read your models: {loadError}</p>
            <Button size="sm" onClick={() => void useCustomModels.getState().load()}>
              Retry
            </Button>
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-panel border border-dashed border-border p-6">
            <p className="text-[13px] font-medium">No models yet</p>
            <p className="text-xs text-fg-muted">
              Search Hugging Face, paste a model link, or pick a .gguf file or MLX folder on this
              computer.
            </p>
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
              <Plus size={12} />
              Add a model
            </Button>
          </div>
        ) : (
          <ul aria-label="Your models" className="flex flex-col gap-2">
            {models.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                selected={picked.includes(m.id)}
                serving={serving(m)}
                onToggle={() => toggle(m.id)}
                onChat={() => void startChatWith(m)}
                onEdit={() => setEditing(m)}
                onDelete={() => setRemoving(m)}
                onDeleteChats={() => void askToClear(m)}
                {...(storedSource(m) && isMacPlatform() ? { onRun: () => setRunning(m) } : {})}
              />
            ))}
          </ul>
        )}

        {models.length > 0 && <ModelTestPanel models={chosen} />}
      </div>

      {openAdd && (
        <AddModelDialog
          onClose={() => setAddOpen(false)}
          onAdded={(m) => {
            setAddOpen(false);
            toast(`Added ${m.displayName}`);
          }}
        />
      )}
      {editing && (
        <ModelSettingsForm
          model={editing}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            await useCustomModels.getState().update(editing.id, input);
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={running !== null}
        title={`Run ${running?.displayName ?? 'model'} in Terminal?`}
        confirmLabel={starting ? 'Opening…' : 'Open Terminal'}
        onCancel={() => setRunning(null)}
        onConfirm={() => {
          if (running) void run(running);
        }}
      >
        <p>Terminal shows this command and runs it when you press Enter there:</p>
        {running && commandFor(running) && (
          <div className="mt-2 flex items-start gap-1 rounded-control border border-border bg-bg p-2">
            <code className="selectable min-w-0 flex-1 font-mono text-[12px] break-all">
              {commandFor(running)}
            </code>
            <CopyButton text={commandFor(running) ?? ''} label="Copy command" />
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={clearing !== null}
        title={`Delete ${clearing?.ids.length ?? 0} chat${clearing?.ids.length === 1 ? '' : 's'} with ${clearing?.model.displayName ?? 'this model'}?`}
        confirmLabel="Delete chats"
        destructive
        onCancel={() => setClearing(null)}
        onConfirm={() => {
          const target = clearing;
          setClearing(null);
          if (!target) return;
          // A reply still streaming into one of them is stopped first, as for a single delete.
          for (const id of target.ids) chatStore.getState().stop(id);
          void conversationsStore
            .getState()
            .removeMany(target.ids)
            .then(
              () => toast(`Deleted ${target.ids.length} chat${target.ids.length === 1 ? '' : 's'}`),
              (err: unknown) =>
                toast(
                  `Could not delete the chats: ${err instanceof Error ? err.message : String(err)}`,
                ),
            );
        }}
      >
        Every chat set to this model, and all their messages, are permanently deleted from this
        computer. The model stays in the Model Lab.
      </ConfirmDialog>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.displayName ?? 'model'}?`}
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) return;
          setPicked((p) => p.filter((x) => x !== target.id));
          void useCustomModels
            .getState()
            .remove(target.id)
            .catch((err: unknown) =>
              toast(`Could not remove: ${err instanceof Error ? err.message : String(err)}`),
            );
        }}
      >
        It leaves Command Center only. Downloaded weights stay with your runtime, and chats that
        used it keep their messages.
      </ConfirmDialog>
    </div>
  );
}
