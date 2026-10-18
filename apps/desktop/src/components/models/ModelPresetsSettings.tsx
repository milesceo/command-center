import { useEffect, useState } from 'react';
import type { CustomModel } from '../../lib/repo-models';
import { useCustomModels } from '../../stores/custom-models';
import { useUiStore } from '../../stores/ui';
import { Row } from '../settings/parts';
import { Button } from '../ui/button';
import { ModelSettingsForm } from './ModelSettingsForm';

/** Settings > AI agents: each Model Lab model's presets, editable without leaving Settings. */
export function ModelPresetsSettings() {
  const models = useCustomModels((s) => s.models);
  const loaded = useCustomModels((s) => s.loaded);
  const [editing, setEditing] = useState<CustomModel | null>(null);

  useEffect(() => {
    if (!loaded) void useCustomModels.getState().load();
  }, [loaded]);

  return (
    <>
      <Row
        label="Model presets"
        hint="Sampling, length and a default system prompt for each model you added. A chat can override them in its Chat settings."
      >
        {models.length === 0 && (
          <Button size="sm" onClick={() => useUiStore.getState().setView('models')}>
            Open Model Lab
          </Button>
        )}
      </Row>
      {models.length > 0 && (
        <ul aria-label="Model presets" className="flex flex-col gap-1">
          {models.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-control border border-border px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate text-[13px]">{m.displayName}</span>
              <Button
                size="sm"
                onClick={() => setEditing(m)}
                aria-label={`Edit presets for ${m.displayName}`}
              >
                Edit presets
              </Button>
            </li>
          ))}
        </ul>
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
    </>
  );
}
