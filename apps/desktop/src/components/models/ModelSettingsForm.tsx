import type { ChatParams } from '@command-center/protocol';
import { useState } from 'react';
import { parseTagInput } from '../../lib/prompt-library';
import { CustomModelError, validateCustomModel, type CustomModel } from '../../lib/repo-models';
import type { CustomModelInput } from '../../lib/repo-models';
import { Button } from '../ui/button';
import { Modal } from '../ui/dialog';

/** One-click starting points; each only sets sampling, the user can still edit every field. */
export const PRESETS: { id: string; label: string; params: ChatParams }[] = [
  { id: 'precise', label: 'Precise', params: { temperature: 0.2, topP: 0.9 } },
  { id: 'balanced', label: 'Balanced', params: { temperature: 0.7, topP: 0.95 } },
  { id: 'creative', label: 'Creative', params: { temperature: 1, topP: 0.98 } },
];

type NumberKey = Exclude<keyof ChatParams, 'stop'>;

const FIELDS: { key: NumberKey; label: string; hint: string; step: string; local?: boolean }[] = [
  { key: 'temperature', label: 'Temperature', hint: '0 to 2. Lower is more focused.', step: '0.1' },
  { key: 'topP', label: 'Top P', hint: '0 to 1.', step: '0.05' },
  { key: 'maxTokens', label: 'Max reply tokens', hint: 'Whole number.', step: '1' },
  { key: 'topK', label: 'Top K', hint: '1 to 1000.', step: '1', local: true },
  {
    key: 'repetitionPenalty',
    label: 'Repetition penalty',
    hint: '0.5 to 2. 1 is off.',
    step: '0.05',
    local: true,
  },
  {
    key: 'contextLength',
    label: 'Context length',
    hint: 'Saved with the model; servers set it when they start, so chats do not send it yet.',
    step: '1',
    local: true,
  },
];

const inputClass =
  'h-8 w-full rounded-control border border-border bg-bg px-2 text-[13px] outline-none placeholder:text-fg-subtle focus:border-border-strong';

interface Props {
  model: CustomModel;
  onSave: (input: CustomModelInput) => Promise<void>;
  onCancel: () => void;
}

/** Edit a Model Lab model: its name, server, default system prompt and sampling presets. */
export function ModelSettingsForm({ model, onSave, onCancel }: Props) {
  const local = model.provider === 'local';
  const [displayName, setDisplayName] = useState(model.displayName);
  const [modelName, setModelName] = useState(model.model);
  const [baseUrl, setBaseUrl] = useState(model.baseUrl ?? '');
  const [systemPrompt, setSystemPrompt] = useState(model.systemPrompt ?? '');
  const [adapterPath, setAdapterPath] = useState(model.adapterPath ?? '');
  const [tags, setTags] = useState(model.tags.join(', '));
  const [values, setValues] = useState<Record<NumberKey, string>>(() => {
    const out = {} as Record<NumberKey, string>;
    for (const f of FIELDS) out[f.key] = model.params[f.key]?.toString() ?? '';
    return out;
  });
  const [stop, setStop] = useState((model.params.stop ?? []).join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const build = (): CustomModelInput => {
    const params: ChatParams = {};
    for (const f of FIELDS) {
      const raw = values[f.key].trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new CustomModelError(`${f.label} must be a number.`);
      params[f.key] = n;
    }
    const stops = stop
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (stops.length > 0) params.stop = stops;
    return validateCustomModel({
      provider: model.provider,
      hfRepo: model.hfRepo,
      runtime: model.runtime,
      quant: model.quant,
      filePath: model.filePath,
      displayName,
      model: modelName.trim(),
      baseUrl: local ? baseUrl.trim() : null,
      systemPrompt: systemPrompt.trim() ? systemPrompt : null,
      adapterPath: model.runtime === 'mlx' && adapterPath.trim() ? adapterPath.trim() : null,
      params,
      tags: parseTagInput(tags),
    });
  };

  const submit = async () => {
    setError(null);
    let input: CustomModelInput;
    try {
      input = build();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setSaving(true);
    try {
      await onSave(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (params: ChatParams) =>
    setValues((v) => ({
      ...v,
      temperature: params.temperature?.toString() ?? '',
      topP: params.topP?.toString() ?? '',
    }));

  return (
    <Modal title={`Model settings: ${model.displayName}`} onClose={onCancel} width="max-w-xl">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">Name</span>
            <input
              className={inputClass}
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">
              {local ? 'Model name the server knows' : 'Hugging Face model id'}
            </span>
            <input
              className={`${inputClass} font-mono`}
              value={modelName}
              spellCheck={false}
              onChange={(e) => setModelName(e.target.value)}
            />
            {!local && (
              <span className="text-[11px] text-fg-subtle">
                Add <span className="font-mono">:fastest</span>,{' '}
                <span className="font-mono">:cheapest</span> or a provider name to choose who serves
                it.
              </span>
            )}
          </label>
          {local && (
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Server address</span>
              <input
                className={`${inputClass} font-mono`}
                value={baseUrl}
                spellCheck={false}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <span className="text-[11px] text-fg-subtle">
                Only this computer is used unless Settings &gt; AI agents allows remote servers.
              </span>
            </label>
          )}
          {model.runtime === 'mlx' && (
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">LoRA adapter folder (optional)</span>
              <input
                className={`${inputClass} font-mono`}
                value={adapterPath}
                placeholder="/Users/you/adapters/my-lora"
                spellCheck={false}
                onChange={(e) => setAdapterPath(e.target.value)}
              />
              <span className="text-[11px] text-fg-subtle">
                Passed to mlx_lm.server as --adapter-path the next time you run it.
              </span>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">Default system prompt</span>
            <textarea
              className="min-h-20 rounded-control border border-border bg-bg p-2 text-[13px] outline-none focus:border-border-strong"
              value={systemPrompt}
              placeholder="Used when a chat has no system prompt of its own."
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-fg-muted">Sampling</legend>
            <div className="flex gap-1.5" role="group" aria-label="Presets">
              {PRESETS.map((p) => (
                <Button key={p.id} size="sm" onClick={() => applyPreset(p.params)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {FIELDS.filter((f) => local || !f.local).map((f) => (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-fg-muted">{f.label}</span>
                  <input
                    className={inputClass}
                    type="number"
                    inputMode="decimal"
                    step={f.step}
                    value={values[f.key]}
                    placeholder="Default"
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  <span className="text-[11px] text-fg-subtle">{f.hint}</span>
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Stop sequences (one per line)</span>
              <textarea
                className="min-h-14 rounded-control border border-border bg-bg p-2 font-mono text-[12px] outline-none focus:border-border-strong"
                value={stop}
                onChange={(e) => setStop(e.target.value)}
              />
            </label>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">Tags (comma separated)</span>
            <input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
