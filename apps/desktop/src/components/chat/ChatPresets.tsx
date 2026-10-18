import { parseChatParams, type ChatParams } from '@command-center/protocol';
import { useState } from 'react';
import { conversationsStore, useActiveSettings } from '../../stores/conversations';
import { customModelId, useCustomModels } from '../../stores/custom-models';
import { Button } from '../ui/button';

type Key = 'temperature' | 'topP' | 'maxTokens';

const FIELDS: { key: Key; label: string; step: string }[] = [
  { key: 'temperature', label: 'Temperature', step: '0.1' },
  { key: 'topP', label: 'Top P', step: '0.05' },
  { key: 'maxTokens', label: 'Max tokens', step: '1' },
];

const toText = (p: ChatParams | null) => {
  const out = {} as Record<Key, string>;
  for (const f of FIELDS) out[f.key] = p?.[f.key]?.toString() ?? '';
  return out;
};

/**
 * This chat's overrides of its Model Lab model's presets. Empty fields use the model's own
 * value (shown as the placeholder). Shown in Chat settings only for Model Lab models; mount it
 * with a key per conversation so the fields reset when the chat changes.
 */
export function ChatPresets() {
  const settings = useActiveSettings();
  const id = customModelId(settings.model);
  const model = useCustomModels((s) => s.models.find((m) => m.id === id) ?? null);
  const [values, setValues] = useState(() => toText(settings.modelParams));
  const [error, setError] = useState<string | null>(null);
  if (!id || !model) return null;

  const save = (next: Record<Key, string>) => {
    const raw: Record<string, number> = {};
    for (const f of FIELDS) {
      const text = next[f.key].trim();
      if (text !== '') raw[f.key] = Number(text);
    }
    const parsed = parseChatParams(raw);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    const params = Object.keys(parsed.value).length > 0 ? parsed.value : null;
    void conversationsStore.getState().updateSettings({ modelParams: params });
  };

  return (
    <fieldset className="mt-3" data-testid="chat-presets">
      <legend className="text-xs font-medium text-fg-muted">Presets for this chat</legend>
      <p className="mt-0.5 text-[11px] text-fg-subtle">
        Empty uses {model.displayName}&rsquo;s own setting from the Model Lab.
      </p>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-[11px] text-fg-muted">
            {f.label}
            <input
              type="number"
              inputMode="decimal"
              step={f.step}
              value={values[f.key]}
              placeholder={model.params[f.key]?.toString() ?? 'Default'}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              onBlur={() => save(values)}
              className="h-7 w-full rounded-control border border-border bg-surface px-1.5 text-xs text-fg outline-none focus:border-border-strong"
            />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      )}
      {settings.modelParams && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1"
          onClick={() => {
            const cleared = toText(null);
            setValues(cleared);
            save(cleared);
          }}
        >
          Use the model&rsquo;s presets
        </Button>
      )}
    </fieldset>
  );
}
