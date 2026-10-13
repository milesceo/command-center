import type { UsageReportEvent, UsageWindow } from '@programish/protocol';
import { createStore, useStore } from 'zustand';
import type { BridgeClient } from '../lib/bridge';
import { getBridgeClient } from '../lib/bridge-client';
import { getDb, type Db } from '../lib/db';
import * as repo from '../lib/repo-usage';
import {
  fillDays,
  fillWeeks,
  startOfDay,
  startOfWeek,
  type SeriesPoint,
} from '../lib/usage-series';
import { useBridgeStore } from './bridge';

export type RangeDays = 7 | 30 | 90;
export type Metric = 'tokens' | 'cost';
export const WEEKS_SHOWN = 12;

export interface UsageData {
  totals: repo.UsageTotals;
  daily: SeriesPoint[];
  weekly: SeriesPoint[];
  models: repo.ModelRow[];
  top: repo.ConversationUsageRow[];
  windows: repo.StoredWindow[];
}

export type ReportState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      available: boolean;
      subscriptionType: string | null;
      extraUsage: UsageReportEvent['extraUsage'];
      fetchedAt: number;
    };

export interface UsageState {
  rangeDays: RangeDays;
  metric: Metric;
  data: UsageData | null;
  loading: boolean;
  error: string | null;
  report: ReportState;
  /** Totals per conversation, for the chat header. */
  conversationTotals: Record<string, repo.UsageTotals>;

  load: () => Promise<void>;
  setRange: (days: RangeDays) => Promise<void>;
  setMetric: (metric: Metric) => void;
  /** Asks the SDK for the plan windows (the "Refresh" button and opening the Usage view). */
  refreshReport: () => Promise<void>;
  refreshConversation: (conversationId: string) => Promise<void>;
  /** Windows the runtime attached to a chat: remembered so headroom shows even without a report. */
  noteWindows: (windows: UsageWindow[]) => Promise<void>;
}

export interface UsageDeps {
  database: () => Promise<Db>;
  client: () => BridgeClient;
  ensureConnected: () => Promise<void>;
  now: () => number;
}

const defaultEnsureConnected = async () => {
  await useBridgeStore.getState().connect();
  const { status, error } = useBridgeStore.getState();
  if (status !== 'ready') throw new Error(error ?? 'The Claude bridge is not available.');
};

export function createUsageStore(deps: Partial<UsageDeps> = {}) {
  const database = deps.database ?? getDb;
  const client = deps.client ?? getBridgeClient;
  const ensureConnected = deps.ensureConnected ?? defaultEnsureConnected;
  const now = deps.now ?? Date.now;
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  return createStore<UsageState>()((set, get) => ({
    rangeDays: 30,
    metric: 'tokens',
    data: null,
    loading: false,
    error: null,
    report: { status: 'idle' },
    conversationTotals: {},

    async load() {
      set({ loading: true, error: null });
      try {
        const db = await database();
        const { rangeDays } = get();
        const today = new Date(now());
        const since = startOfDay(
          new Date(today.getFullYear(), today.getMonth(), today.getDate() - (rangeDays - 1)),
        ).getTime();
        const weeksSince = startOfWeek(
          new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7 * (WEEKS_SHOWN - 1)),
        ).getTime();
        const [totals, daily, weekly, models, top, windows] = await Promise.all([
          repo.usageTotals(db, since),
          repo.usageByDay(db, since),
          repo.usageByWeek(db, weeksSince),
          repo.usageByModel(db, since),
          repo.topConversations(db, since, 10),
          repo.loadWindows(db),
        ]);
        // A newer range selection may have started while this was loading.
        if (get().rangeDays !== rangeDays) return;
        set({
          data: {
            totals,
            daily: fillDays(daily, rangeDays, today),
            weekly: fillWeeks(weekly, WEEKS_SHOWN, today),
            models,
            top,
            windows,
          },
          loading: false,
        });
      } catch (err) {
        set({ loading: false, error: message(err) });
      }
    },

    async setRange(rangeDays) {
      set({ rangeDays });
      await get().load();
    },

    setMetric: (metric) => set({ metric }),

    async refreshReport() {
      if (get().report.status === 'loading') return;
      set({ report: { status: 'loading' } });
      try {
        await ensureConnected();
        const report = await client().usage();
        const db = await database();
        // A plan without usage windows (API key, third-party login) must not wipe what chats observed.
        if (report.available) await repo.replaceWindows(db, report.windows, now());
        set({
          report: {
            status: 'ready',
            available: report.available,
            subscriptionType: report.subscriptionType,
            extraUsage: report.extraUsage,
            fetchedAt: now(),
          },
        });
        await get().load();
      } catch (err) {
        set({ report: { status: 'error', message: message(err) } });
      }
    },

    async refreshConversation(conversationId) {
      try {
        const totals = await repo.conversationTotals(await database(), conversationId);
        set((s) => ({ conversationTotals: { ...s.conversationTotals, [conversationId]: totals } }));
      } catch (err) {
        console.error('[usage] could not read conversation totals', err);
      }
    },

    async noteWindows(windows) {
      if (windows.length === 0) return;
      try {
        const db = await database();
        await repo.saveWindows(db, windows, 'chat', now());
        const stored = await repo.loadWindows(db);
        set((s) => (s.data ? { data: { ...s.data, windows: stored } } : s));
      } catch (err) {
        console.error('[usage] could not save plan windows', err);
      }
    },
  }));
}

export const usageStore = createUsageStore();

export function useUsage<T>(selector: (state: UsageState) => T): T {
  return useStore(usageStore, selector);
}
