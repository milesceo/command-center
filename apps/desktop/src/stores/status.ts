import { create } from 'zustand';
import type { FeedModel, ProviderId, StatusFeed } from '@command-center/protocol';
import {
  REFRESH_MS,
  detectNewModels,
  fetchFeed,
  loadCachedFeed,
  loadKnown,
  saveCachedFeed,
  saveKnown,
  type ModelNotice,
} from '../lib/status-feed';
import { usePrefs } from './prefs';

interface StatusState {
  feed: StatusFeed | null;
  /** Epoch ms the shown copy was fetched (network or cache). */
  fetchedAt: number | null;
  source: 'network' | 'cache' | 'none';
  /** Why the last refresh failed, when it did. The cached copy stays in use. */
  error: string | null;
  refreshing: boolean;
  /** New models waiting to be dismissed. */
  notices: ModelNotice[];
  /** Models the feed announced for each provider; the picker offers them. */
  added: Partial<Record<ProviderId, FeedModel[]>>;

  /** Loads the cache, refreshes now, and keeps refreshing every 30 minutes. Safe to call twice. */
  start: () => void;
  stop: () => void;
  refresh: () => Promise<void>;
  dismiss: (provider: ProviderId, modelId: string) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let onOnline: (() => void) | null = null;

const connectedProviders = (): Set<ProviderId> => {
  const { connections } = usePrefs.getState().prefs.providers;
  return new Set(
    (Object.keys(connections) as ProviderId[]).filter((id) => connections[id].enabled),
  );
};

export const useStatus = create<StatusState>()((set, get) => ({
  feed: null,
  fetchedAt: null,
  source: 'none',
  error: null,
  refreshing: false,
  notices: [],
  added: loadKnown().added,

  start: () => {
    if (timer !== null) return;
    const cached = loadCachedFeed();
    if (cached && get().feed === null) {
      set({ feed: cached.feed, fetchedAt: cached.fetchedAt, source: 'cache' });
    }
    void get().refresh();
    timer = setInterval(() => void get().refresh(), REFRESH_MS);
    onOnline = () => void get().refresh();
    window.addEventListener('online', onOnline);
  },

  stop: () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (onOnline) window.removeEventListener('online', onOnline);
    onOnline = null;
  },

  refresh: async () => {
    if (get().refreshing) return;
    set({ refreshing: true });
    const result = await fetchFeed();
    if (!result.ok) {
      // Offline or the feed is broken: keep showing the last good copy.
      set((s) => ({
        refreshing: false,
        error: result.error,
        source: s.feed ? 'cache' : 'none',
      }));
      return;
    }

    const now = Date.now();
    saveCachedFeed({ fetchedAt: now, feed: result.feed });
    const detection = detectNewModels(result.feed, loadKnown(), connectedProviders());
    if (detection.changed) saveKnown(detection.known);

    set((s) => {
      const existing = new Set(s.notices.map((n) => `${n.provider}:${n.model.id}`));
      const fresh = detection.announced.filter((n) => !existing.has(`${n.provider}:${n.model.id}`));
      return {
        feed: result.feed,
        fetchedAt: now,
        source: 'network',
        error: null,
        refreshing: false,
        notices: [...s.notices, ...fresh],
        added: detection.known.added,
      };
    });
  },

  dismiss: (provider, modelId) => {
    const known = loadKnown();
    const key = `${provider}:${modelId}`;
    if (!known.dismissed.includes(key)) {
      saveKnown({ ...known, dismissed: [...known.dismissed, key] });
    }
    set((s) => ({
      notices: s.notices.filter((n) => !(n.provider === provider && n.model.id === modelId)),
    }));
  },
}));
