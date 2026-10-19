import { create } from 'zustand';
import { getDb } from '../lib/db';
import * as repo from '../lib/repo-plans';
import type { PlanSummary } from '../lib/repo-plans';

interface PlansState {
  plans: PlanSummary[];
  loaded: boolean;
  error: string | null;
  /** The plan open in the reader; the first plan when none was picked. */
  selectedId: string | null;
  load: () => Promise<void>;
  select: (id: string) => void;
  add: (input: { title: string; html: string; source: string | null }) => Promise<PlanSummary>;
  rename: (id: string, title: string) => Promise<void>;
  moveFirst: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** Business plans: titles in memory, documents read from SQLite when one is opened. */
export const usePlans = create<PlansState>()((set, get) => ({
  plans: [],
  loaded: false,
  error: null,
  selectedId: null,

  async load() {
    try {
      const plans = await repo.listPlans(await getDb());
      const { selectedId } = get();
      set({
        plans,
        loaded: true,
        error: null,
        selectedId: plans.some((p) => p.id === selectedId) ? selectedId : (plans[0]?.id ?? null),
      });
    } catch (err) {
      set({ loaded: true, error: err instanceof Error ? err.message : String(err) });
    }
  },

  select: (id) => set({ selectedId: id }),

  async add(input) {
    const plan = await repo.createPlan(await getDb(), input);
    set({ selectedId: plan.id });
    await get().load();
    return plan;
  },

  async rename(id, title) {
    await repo.renamePlan(await getDb(), id, title);
    await get().load();
  },

  async moveFirst(id) {
    await repo.movePlanFirst(await getDb(), id);
    await get().load();
  },

  async remove(id) {
    const { plans, selectedId } = get();
    await repo.deletePlan(await getDb(), id);
    if (selectedId === id) {
      // Open the next plan in the list, or the previous one when the last was removed.
      const at = plans.findIndex((p) => p.id === id);
      set({ selectedId: plans[at + 1]?.id ?? plans[at - 1]?.id ?? null });
    }
    await get().load();
  },
}));
