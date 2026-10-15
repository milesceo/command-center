import { PROVIDER_IDS, type ProviderId } from '@geeked/protocol';
import { useMemo } from 'react';
import { fallbackModels, providerName } from '../../lib/providers';
import { conversationsStore, useActiveSettings } from '../../stores/conversations';
import { usePrefs } from '../../stores/prefs';
import { useProviders } from '../../stores/providers';

const selectClass =
  'h-6 max-w-[9rem] rounded-control bg-transparent px-1 text-[11px] text-fg-muted outline-none hover:bg-hover focus-visible:bg-hover';

/**
 * Which provider and model answer the current chat. Providers appear when the user enabled
 * them (onboarding or Settings), plus whichever one this chat already uses. Changing the
 * provider resets the model, because model ids are provider-specific.
 */
export function ProviderModelPicker() {
  const settings = useActiveSettings();
  const connections = usePrefs((s) => s.prefs.providers.connections);
  const infos = useProviders((s) => s.infos);

  const providers = useMemo(
    () => PROVIDER_IDS.filter((id) => connections[id].enabled || id === settings.provider),
    [connections, settings.provider],
  );
  const models = useMemo(() => {
    const live = infos[settings.provider]?.models;
    return live && live.length > 0 ? live : fallbackModels(settings.provider);
  }, [infos, settings.provider]);

  const update = conversationsStore.getState().updateSettings;

  return (
    <span className="flex items-center gap-0.5" data-testid="provider-model-picker">
      {providers.length > 1 && (
        <select
          aria-label="Provider"
          value={settings.provider}
          onChange={(e) => void update({ provider: e.target.value as ProviderId, model: null })}
          className={selectClass}
        >
          {providers.map((id) => (
            <option key={id} value={id} className="bg-elevated">
              {providerName(id)}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label="Model"
        value={settings.model ?? 'default'}
        onChange={(e) =>
          void update({ model: e.target.value === 'default' ? null : e.target.value })
        }
        className={selectClass}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id} className="bg-elevated">
            {m.label}
          </option>
        ))}
        {settings.model && !models.some((m) => m.id === settings.model) && (
          <option value={settings.model} className="bg-elevated">
            {settings.model}
          </option>
        )}
      </select>
    </span>
  );
}
