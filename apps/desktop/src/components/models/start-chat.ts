import type { CustomModel } from '../../lib/repo-models';
import { conversationsStore } from '../../stores/conversations';
import { customModelRef } from '../../stores/custom-models';
import { usePrefs } from '../../stores/prefs';
import { useUiStore } from '../../stores/ui';

/** Opens a new chat answered by a Model Lab model (Model Lab cards and the palette). */
export async function startChatWith(m: CustomModel): Promise<void> {
  const store = conversationsStore.getState();
  store.newChat();
  await store.updateSettings({ provider: m.provider, model: customModelRef(m.id) });
  // A provider that is not switched on yet is switched on, so the picker shows it.
  const prefs = usePrefs.getState();
  if (!prefs.prefs.providers.connections[m.provider].enabled) {
    prefs.setConnection(m.provider, {
      enabled: true,
      method: m.provider === 'huggingface' ? 'apiKey' : null,
    });
  }
  useUiStore.getState().setView('chat');
}
