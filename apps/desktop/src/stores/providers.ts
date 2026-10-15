import { create } from 'zustand';
import { PROVIDER_IDS, type ProviderId, type ProviderInfo } from '@geeked/protocol';
import { getBridgeClient } from '../lib/bridge-client';
import { secrets } from '../lib/secrets';
import { isTauri } from '../lib/tauri';
import { usePrefs } from './prefs';

type KeyMap = Record<ProviderId, boolean>;

const NO_KEYS = Object.fromEntries(PROVIDER_IDS.map((id) => [id, false])) as KeyMap;

interface ProvidersState {
  /** Latest live report from the bridge, by provider. Empty until the first refresh. */
  infos: Partial<Record<ProviderId, ProviderInfo>>;
  /** Which providers have an API key in the OS credential store (the keys themselves are not here). */
  hasKey: KeyMap;
  loading: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  /** Opens the provider's official sign-in; the caller polls `refresh` while the user finishes. */
  login: (id: ProviderId) => Promise<void>;
  saveKey: (id: ProviderId, key: string) => Promise<void>;
  removeKey: (id: ProviderId) => Promise<void>;
}

async function readKeys(): Promise<KeyMap> {
  const entries = await Promise.all(
    PROVIDER_IDS.map(async (id) => [id, await secrets.exists(id).catch(() => false)] as const),
  );
  return Object.fromEntries(entries) as KeyMap;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useProviders = create<ProvidersState>()((set, get) => ({
  infos: {},
  hasKey: NO_KEYS,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const hasKey = await readKeys();
      set({ hasKey });
      if (!isTauri()) {
        set({ loading: false, error: null });
        return;
      }
      const list = await getBridgeClient().providers(PROVIDER_IDS.filter((id) => hasKey[id]));
      set({
        infos: Object.fromEntries(list.map((p) => [p.id, p])) as Partial<
          Record<ProviderId, ProviderInfo>
        >,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({ loading: false, error: message(err) });
    }
  },

  login: async (id) => {
    try {
      const list = await getBridgeClient().loginProvider(id);
      set({
        infos: Object.fromEntries(list.map((p) => [p.id, p])) as Partial<
          Record<ProviderId, ProviderInfo>
        >,
        error: null,
      });
    } catch (err) {
      set({ error: message(err) });
      throw err;
    }
  },

  saveKey: async (id, key) => {
    await secrets.set(id, key);
    usePrefs.getState().setConnection(id, { enabled: true, method: 'apiKey' });
    set({ hasKey: { ...get().hasKey, [id]: true } });
    void get().refresh();
  },

  removeKey: async (id) => {
    await secrets.delete(id);
    set({ hasKey: { ...get().hasKey, [id]: false } });
    const { connections } = usePrefs.getState().prefs.providers;
    if (connections[id].method === 'apiKey') {
      usePrefs.getState().setConnection(id, { method: null });
    }
    void get().refresh();
  },
}));
